---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
vars:
  plan_doc: docs/plans/poe-agent-providers.md

tasks:
  - id: rename-dotted-tool-fixtures
    title: Rename dotted tool fixtures to underscored names
    prompt: |
      Pre-refactor mechanical rename of dotted tool-name fixtures so a later step can delete the silent sanitiser without breaking tests.

      Design context: {{plan_doc}}

      ## Scope

      Rename tool names that contain `.` to the underscored form in these test files only. Do NOT touch production code — the silent sanitiser in `packages/poe-agent/src/models/poe.ts` still handles any stragglers for now.

      - `packages/poe-agent/src/agent.test.ts`:
        - `memory.save` → `memory_save`
        - `web.search` → `web_search`
        - `doc.write` → `doc_write`
        - `alpha.tool` → `alpha_tool`
        - `beta.tool` → `beta_tool`
        - `schema.tool` → `schema_tool`
        - `repo.search` → `repo_search`
      - `packages/poe-agent/src/agent.runtime.e2e.test.ts`:
        - `tools.initial` → `tools_initial`
        - `tools.leaked` → `tools_leaked`
        - `tools.alpha` → `tools_alpha`
        - `tools.beta` → `tools_beta`
        - `tools.fail` → `tools_fail`
      - `packages/poe-agent/src/runtime/runtime.test.ts`:
        - `tool.a` → `tool_a`
        - `search.web` → `search_web`
        - `repo.search` → `repo_search`
        - `internal.audit` → `internal_audit`
        - `git.status` → `git_status`
        - `mcp-server.status` → `mcp-server_status`
      - `packages/poe-agent/src/runtime/plugin-api-impl.test.ts`:
        - `custom.tool` → `custom_tool`
        - `alpha.static` → `alpha_static`
        - `alpha.dynamic` → `alpha_dynamic`
      - `packages/poe-agent/src/plugins/plugins.test.ts`:
        - `repo.search` → `repo_search`

      ## Also

      Sweep the poe-agent package for any other dotted tool fixtures and rename them the same way. If you find a `.` in a tool name in production (non-test) code, STOP — do not rename; surface it back because the plan considers that a stop condition.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `grep -R "\"[a-zA-Z0-9_-]*\\.[a-zA-Z0-9_-]*\"" packages/poe-agent/src --include="*.test.ts"` shows no dotted tool-name fixtures.
    status:
      implement: done
      test: done
      commit: done

  - id: tool-names-validator
    title: Add tool-name validator, wire into registration, remove silent sanitiser
    prompt: |
      Replace the silent `[^a-zA-Z0-9_-]` tool-name sanitiser with a fail-fast validator at tool-registration time.

      Design context: {{plan_doc}}

      ## Create

      `packages/poe-agent/src/runtime/tool-names.ts`:

      - `export const TOOL_NAME_PATTERN: RegExp = /^[a-zA-Z0-9_-]+$/`
      - `export class InvalidToolNameError extends Error` (message includes the offending name and `contributor` when provided)
      - `export function assertValidToolName(name: string, contributor?: string): void` — throws `InvalidToolNameError` when name does not match the pattern or is empty.

      `packages/poe-agent/src/runtime/tool-names.test.ts`:

      - Valid: `foo`, `foo_bar`, `foo-bar`, `Foo123` — no throw.
      - Invalid: `foo.bar`, `foo bar`, `foo/bar`, empty string — throw `InvalidToolNameError`.
      - Error message includes `contributor` when passed (e.g. `"plugin: files-plugin"`).

      Use TDD — tests first.

      ## Wire in

      - `packages/poe-agent/src/runtime/plugin-api-impl.ts`: call `assertValidToolName(tool.name, pluginName)` at the top of `addTool` (pluginName is the plugin contributing the tool).
      - `packages/poe-agent/src/agent.ts`: call `assertValidToolName(tool.name)` in the builder `.tools(...)` path.

      ## Remove silent sanitisation

      In `packages/poe-agent/src/models/poe.ts`:

      - Delete the `sanitizeToolName` regex / helper (lines 151-154 area).
      - Delete the `originalByApiName` round-trip book-keeping (lines 25-32 area).
      - Providers must pass tool names through verbatim to OpenAI now.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `grep -R "sanitizeToolName\|INVALID_TOOL_NAME_CHAR\|originalByApiName" packages/` — zero matches.
      - `npx tsc -p packages/poe-agent/tsconfig.json --noEmit` — clean.
    status:
      implement: done
      test: done
      commit: done

  - id: reshape-acp-core-events
    title: Reshape AcpModel to event stream and refactor runLoop
    prompt: |
      Introduce `ProviderStreamEvent` and rewrite `AcpModel` / `AcpModelResponse` around an async iterable of events. Keep existing `createPoeAcpModel` working by adapting it to emit events internally so all existing tests stay green.

      Design context: {{plan_doc}}

      ## Add types

      In `packages/poe-agent/src/runtime/plugin-types.ts`:

      ```ts
      export type ProviderStreamEvent =
        | { type: "text"; text: string }
        | { type: "thinking"; text: string; signature?: string }
        | { type: "redacted_thinking"; data: string }
        | { type: "reasoning_details"; payload: unknown }
        | { type: "tool_use_delta"; id: string; name?: string; argsDelta?: string }
        | { type: "tool_use_complete"; id: string; name: string; args: unknown }
        | { type: "tool_use_json_parse_error"; id: string; raw: string; error: string }
        | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens: number; cacheCreationTokens: number }
        | { type: "stop"; reason: "end_turn" | "tool_use" | "max_tokens" | "error" };
      ```

      ## Reshape model contract

      In `packages/poe-agent/src/runtime/acp-core.ts`:

      - Replace `AcpModelResponse` (message/content/toolCalls/usage/deltas) with:
        ```ts
        export type AcpModelResponse = { events: AsyncIterable<ProviderStreamEvent> };
        ```
      - `AcpModel.complete(request)` returns `Promise<{ events: AsyncIterable<ProviderStreamEvent> }>`.
      - Remove `normalizeModelResponse` / `fromOpenAiToolCalls` helpers (dead once providers emit events).

      ## Refactor runLoop

      Consume `events` via a single `for await` and accumulate into the outgoing `ChatMessage`:

      - `text` events → concatenate into message content; emit `message.delta` `AcpEvent`s.
      - `thinking` / `redacted_thinking` / `reasoning_details` → preserve on the outgoing `ChatMessage` for round-trip.
      - `tool_use_delta` → accumulate id/name/argsDelta buffer keyed by id; surface as `tool.intent` AcpEvents.
      - `tool_use_complete` → push completed tool_call onto the `ChatMessage.tool_calls` array.
      - `tool_use_json_parse_error` → surface via the existing tool-error path.
      - `usage` → emit on the runLoop event stream exactly once per iteration.
      - `stop` → drives termination reason.

      No-tool-call termination must still work for a reasoning-only response (empty content + preserved reasoning metadata).

      ## Adapt existing Poe model

      In `packages/poe-agent/src/models/poe.ts`: rewrite `createPoeAcpModel` to emit `ProviderStreamEvent`s from its existing streaming fetch path. Do not change its public signature except the `AcpModelResponse` shape change. Keep it as a temporary bridge — it is replaced and deleted in a later task.

      ## Tests

      Extend `packages/poe-agent/src/runtime/acp-core.test.ts`:

      - Event-stream reconstructor: `text` events join into final message content.
      - `tool_use_complete` events accumulate into `tool_calls`.
      - `thinking` / `reasoning_details` preserved on the emitted `ChatMessage`.
      - `usage` fires exactly once per iteration.
      - Reasoning-only response terminates without a tool call.

      TDD — tests first.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `npx tsc -p packages/poe-agent/tsconfig.json --noEmit` — clean.
    status:
      implement: done
      test: done
      commit: done

  - id: provider-types-resolver
    title: Add Provider/ProviderContext types and resolve-provider
    prompt: |
      Add the provider contract types and a generic resolver. Not yet wired from `agent.ts` — that's the next task.

      Design context: {{plan_doc}}

      ## Extend plugin-types

      `packages/poe-agent/src/runtime/plugin-types.ts`:

      ```ts
      export type Provider = {
        name: string;
        supports(modelId: string): boolean;
        createModel(modelId: string, ctx: ProviderContext): AcpModel | Promise<AcpModel>;
      };

      export type ProviderContext = {
        fetch: typeof fetch;
        signal?: AbortSignal;
        logger?: Logger;
        options: unknown;
      };

      // Extend existing AgentPlugin type:
      export type AgentPlugin = { /* existing */ providers?: Provider[] };
      ```

      `Logger` is the runtime logger already imported by other plugin-types.

      ## Create resolver

      `packages/poe-agent/src/runtime/resolve-provider.ts`:

      - `export class ProviderResolutionError extends Error` — message lists registered provider names in order and the offending modelId.
      - `export class DuplicateProviderNameError extends Error` — message lists the duplicate name and the contributing plugin entries.
      - `export function collectProviders(plugins: AgentPlugin[]): Provider[]` — walks plugins in order, flattens `providers`, throws `DuplicateProviderNameError` if a `name` repeats. Empty `providers` arrays on a plugin are fine and ignored.
      - `export function resolveProvider(providers: Provider[], modelId: string): Provider` — returns first provider whose `supports(modelId) === true`. If `supports()` throws, wrap into `ProviderResolutionError` (or a dedicated `ProviderConfigError` — pick one name and use it consistently) naming the provider. If no match: throw `ProviderResolutionError`.

      ## Tests

      `packages/poe-agent/src/runtime/resolve-provider.test.ts` (TDD):

      - First-match-wins when two providers both `supports(id)`.
      - `ProviderResolutionError` lists registered names in registration order.
      - `DuplicateProviderNameError` thrown at `collectProviders` if two plugins register the same name.
      - Empty `providers` array on a plugin is ignored.
      - `supports()` throwing is caught, wrapped with provider name, and does NOT fall through.
      - `createModel()` throwing propagates (no fall-through to next provider) — assert the next provider's `supports` is never called after the first match.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `npx tsc -p packages/poe-agent/tsconfig.json --noEmit` — clean.
    status:
      implement: done
      test: done
      commit: done

  - id: openai-dep-auth-helper
    title: Add openai dependency and shared auth helper
    prompt: |
      Add the `openai` SDK as a hard dependency of `@poe-code/poe-agent` and extract the auth-store fallback into a shared helper both providers will use.

      Design context: {{plan_doc}}

      ## Dependency

      `packages/poe-agent/package.json`:

      - Add `"openai": "^<latest-stable>"` to `dependencies`. Pin to the same version used elsewhere in the monorepo if already present; otherwise pick the current stable and make sure `npm install` resolves cleanly.
      - Keep `auth-store` in `dependencies` — the shared helper below uses it.

      Run `npm install` so the lockfile updates.

      ## Shared helper

      Create `packages/poe-agent/src/plugins/openai-auth.ts`:

      ```ts
      export async function resolveOpenaiApiKey(explicit: string | undefined): Promise<string>
      ```

      Behavior lifted from `packages/poe-agent/src/models/poe.ts` (around line 213):

      - If `explicit` is a non-empty string, return it.
      - Otherwise, fall back to `createSecretStore()` / auth-store lookup (same logic as today).
      - If nothing is found, throw with the existing `"run 'poe-code login'"` message. Preserve the user-visible message verbatim.

      ## Tests

      Add a co-located test for the helper (mock the auth-store) covering:

      - Explicit key wins.
      - Auth-store fallback resolves.
      - Missing key throws the `"run 'poe-code login'"` message.

      TDD — tests first.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `npx tsc -p packages/poe-agent/tsconfig.json --noEmit` — clean.
    status:
      implement: done
      test: done
      commit: done

  - id: openai-chat-completions-plugin
    title: Create openai-chat-completions plugin and register
    prompt: |
      Build the first provider plugin. Functionally replaces today's Poe fetch path, but via the `openai` SDK and emitting `ProviderStreamEvent`s.

      Design context: {{plan_doc}}

      ## File

      `packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts`:

      ```ts
      export type OpenaiChatCompletionsPluginOptions = {
        baseUrl?: string;          // default "https://api.poe.com/v1"
        apiKey?: string;           // default: resolveOpenaiApiKey lookup
        organization?: string;
        defaultHeaders?: Record<string, string>;
        timeout?: number;
        maxRetries?: number;
      };

      export const spec: PluginSpec<OpenaiChatCompletionsPluginOptions>; // name: "openai-chat-completions"
      export function openaiChatCompletionsPlugin(opts?: OpenaiChatCompletionsPluginOptions): AgentPlugin;
      ```

      Internal:

      - `createOpenaiChatCompletionsModel(modelId, ctx): AcpModel` constructs `new OpenAI({ baseURL, apiKey, ... })` using `resolveOpenaiApiKey(options.apiKey)` and `options.baseUrl ?? "https://api.poe.com/v1"`. Let the SDK fall back to its own env vars (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORGANIZATION`) only when no explicit option is supplied.
      - `complete()` calls `openai.chat.completions.create({ stream: true, ... })` (or the typed `.stream(...)` variant — pick whichever yields a cleanly typed async iterator) and maps chunks to events via an async generator.
      - `supports: () => true` (catch-all).
      - Plugin factory returns `{ name: "openai-chat-completions-plugin", providers: [{ name: "openai-chat-completions", supports, createModel }] }`.
      - Tool-arg buffering happens in the provider: per-tool-call-id JSON buffers, emit `tool_use_complete` with parsed args at final chunk, or `tool_use_json_parse_error` when buffered args fail to parse.

      ## Chunk → event mapping

      - `ChatCompletionChunk.choices[0].delta.content` → `text`.
      - `delta.tool_calls[].function.arguments` → `tool_use_delta`; `delta.tool_calls[].function.name` sets name on first delta; final chunk closes with `tool_use_complete` or `tool_use_json_parse_error`.
      - Final chunk `usage` → `usage` event (map `prompt_tokens`, `completion_tokens`, cached + cache_creation where present).
      - `choices[0].finish_reason` → `stop` with matching reason.

      ## Register

      Add to `packages/poe-agent/src/plugins/registry.ts` `builtinPluginRegistry` alongside the existing entries:

      ```ts
      import { spec as openaiChatCompletionsSpec } from "./poe-agent-plugin-openai-chat-completions.js";
      ```

      ## Tests

      `packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts` (replaces content of `models/poe.test.ts`, deleted next task). Mock `openai` with `vi.mock("openai", () => ...)`. TDD — tests first:

      - Streaming `delta.content` → `text` events.
      - Streaming `delta.tool_calls[].function.arguments` → `tool_use_delta`s; final chunk emits `tool_use_complete` with parsed args.
      - Malformed tool-call JSON at stream end → `tool_use_json_parse_error`.
      - Final `chunk.usage` → `usage` event with token counts (incl. cached + cache_creation).
      - Auth-store fallback when `apiKey` option omitted.
      - Aborted stream propagates `AbortError`.
      - Tool names are passed through verbatim (validation lives elsewhere).

      Extend `packages/poe-agent/src/plugins/registry.test.ts`:

      - Spec resolves from `agent.plugins: [{ name: "openai-chat-completions" }]`.
      - Options parse correctly.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `npx tsc -p packages/poe-agent/tsconfig.json --noEmit` — clean.
    status:
      implement: done
      test: done
      commit: done

  - id: wire-resolve-provider-delete-models
    title: Swap agent.ts to resolveProvider, update runners, delete models dir
    prompt: |
      Turn on provider resolution, delete the old `models/` directory, and wire the new plugin into every default code path.

      Design context: {{plan_doc}}

      ## agent.ts

      `packages/poe-agent/src/agent.ts`:

      - Remove `import { createPoeAcpModel, type PoeFetchFn } from "./models/poe.js";` (line 2 area).
      - Replace the `createPoeAcpModel(...)` call (lines 227-234 area) with:
        ```ts
        const providers = collectProviders(plugins);
        const provider = resolveProvider(providers, modelName);
        const model = options.acpModel ?? await provider.createModel(modelName, providerContext);
        ```
      - `providerContext` is `{ fetch, signal, logger, options }` — `options` is the resolved plugin's own parsed options. Reuse the existing fetch/signal/logger wiring.
      - Keep the `options.acpModel` DI escape hatch — it bypasses resolution entirely.

      ## Default plugin bundles (critical)

      Without this, ~15 test call sites of `createAgentSession()` crash with `ProviderResolutionError`.

      `packages/poe-agent/src/agent-session.ts` (around lines 85-90):

      - Import `openaiChatCompletionsPlugin` from `./plugins/poe-agent-plugin-openai-chat-completions.js`.
      - Prepend `openaiChatCompletionsPlugin()` to the default plugin list (so it becomes `[openaiChatCompletionsPlugin(), systemPromptPlugin, filesPlugin, shellPlugin, webPlugin]`). The openai-responses plugin is added in the next task.

      `packages/superintendent/src/commands/poe-agent-runner.ts`:

      - Import `openaiChatCompletionsPlugin`.
      - Insert `.use(openaiChatCompletionsPlugin())` at the top of the `.use(...)` chain (before `systemPromptPlugin()`).

      ## Re-exports

      `packages/poe-agent/src/index.ts`:

      Re-export the new public surface:

      - `openaiChatCompletionsPlugin`
      - `Provider`, `ProviderContext`, `ProviderStreamEvent`
      - `InvalidToolNameError`, `ProviderResolutionError`, `DuplicateProviderNameError`

      ## Delete models dir

      - Delete `packages/poe-agent/src/models/poe.ts`.
      - Delete `packages/poe-agent/src/models/poe.test.ts`.
      - Remove the now-empty `packages/poe-agent/src/models/` directory.

      Scan for stray imports of `createPoeAcpModel` or `PoeFetchFn` and remove them.

      ## README

      `packages/poe-agent/README.md` (around line 123): update the documented default bundle to list `openai-chat-completions` first.

      ## Tests (integration)

      Extend `packages/poe-agent/src/agent.test.ts`:

      - Registering only `openai-chat-completions` + requesting any modelId routes to it (catch-all).
      - Registering no provider plugin + requesting any modelId throws `ProviderResolutionError`.
      - `options.acpModel` DI still bypasses resolution.
      - No more `createPoeAcpModel` references anywhere.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `npm run test --workspace=@poe-code/superintendent` — green (runner wiring).
      - `npx tsc --noEmit` (monorepo-wide) — clean.
      - `grep -R "createPoeAcpModel\|PoeFetchFn" packages/` — zero matches.
      - `test -d packages/poe-agent/src/models` — directory absent.
    status:
      implement: done
      test: done
      commit: open

  - id: openai-responses-plugin
    title: Create openai-responses plugin and register
    prompt: |
      Add the second provider plugin, built on `openai.responses.*`. Lands the richer event surface (typed reasoning items, full `ResponseStreamEvent` union).

      Design context: {{plan_doc}}

      ## File

      `packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts`:

      ```ts
      export type OpenaiResponsesPluginOptions = {
        baseUrl?: string;          // default "https://api.poe.com/v1"
        apiKey?: string;           // default: resolveOpenaiApiKey lookup
        organization?: string;
        project?: string;
        defaultHeaders?: Record<string, string>;
        timeout?: number;
        maxRetries?: number;
        reasoningEffort?: "minimal" | "low" | "medium" | "high";
        reasoningSummary?: "auto" | "concise" | "detailed";
        include?: string[];        // default ["reasoning.encrypted_content"]
      };

      export const spec: PluginSpec<OpenaiResponsesPluginOptions>; // name: "openai-responses"
      export function openaiResponsesPlugin(opts?: OpenaiResponsesPluginOptions): AgentPlugin;
      ```

      Internal:

      - `createOpenaiResponsesModel(modelId, ctx): AcpModel` using `new OpenAI({ baseURL, apiKey, organization, project, ... })`.
      - `complete()` calls `openai.responses.stream({ model, input, reasoning, tools, include, ... })`. Thread `reasoningEffort` / `reasoningSummary` into the `reasoning` request param. `include` defaults to `["reasoning.encrypted_content"]` and is overridable.
      - `supports: (id) => id.startsWith("gpt-") || /^o\d/.test(id)`.
      - Plugin factory returns `{ name: "openai-responses-plugin", providers: [{ name: "openai-responses", supports, createModel }] }`.
      - Tool-arg buffering per tool-call id: emit `tool_use_complete` at `response.output_item.done` boundaries, or `tool_use_json_parse_error` if the buffered args fail to parse.

      ## ResponseStreamEvent → ProviderStreamEvent mapping

      - `response.output_text.delta` → `text`.
      - `response.reasoning_summary_text.delta` → `thinking`.
      - `response.output_item.done` for reasoning items → `reasoning_details` (opaque passthrough of the whole item so it can round-trip on subsequent turns).
      - Tool call sequence:
        - `response.output_item.added` (function_call) → initial `tool_use_delta` with `id` + `name`.
        - `response.function_call_arguments.delta` → `tool_use_delta` with `argsDelta`.
        - `response.output_item.done` for function_call → `tool_use_complete` with parsed args.
      - `response.completed` with usage → `usage` event.
      - `response.error` → propagate error.

      ## Register

      - Add spec to `packages/poe-agent/src/plugins/registry.ts` `builtinPluginRegistry`.
      - Re-export `openaiResponsesPlugin` from `packages/poe-agent/src/index.ts`.

      ## Wire into runners

      - `packages/poe-agent/src/agent-session.ts`: prepend `openaiResponsesPlugin()` BEFORE `openaiChatCompletionsPlugin()` in the default plugin list (order matters — first-match-wins, `openai-responses` must see gpt-*/o-series before the catch-all).
      - `packages/superintendent/src/commands/poe-agent-runner.ts`: `.use(openaiResponsesPlugin())` before `.use(openaiChatCompletionsPlugin())` in the `.use(...)` chain.
      - `packages/poe-agent/README.md`: update the documented default bundle accordingly.

      ## Tests

      `packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts` (TDD, mock `openai`):

      - `response.output_text.delta` → `text`.
      - `response.reasoning_summary_text.delta` → `thinking`.
      - `response.output_item.done` for reasoning item → `reasoning_details` opaque passthrough.
      - Tool-call sequence (added → arg deltas → done) yields the right `tool_use_delta` / `tool_use_complete` events with parsed args.
      - `response.completed` with usage → `usage` event.
      - `response.error` → propagates error.
      - `include` defaults to `["reasoning.encrypted_content"]`; overridable via options.
      - `reasoningEffort` / `reasoningSummary` options thread into the `reasoning` request param.

      Extend `packages/poe-agent/src/plugins/registry.test.ts`:

      - Spec resolves from `agent.plugins: [{ name: "openai-responses" }]`.
      - Options parsing for `reasoningEffort`, `reasoningSummary`, `include`.

      Extend `packages/poe-agent/src/agent.test.ts`:

      - Registering both providers + requesting a `gpt-*` modelId routes to `openai-responses` (first match wins).
      - Registering both + requesting a non-matching modelId routes to the catch-all `openai-chat-completions`.
      - Registering only `openai-responses` + requesting `Claude-Sonnet-4.6` throws `ProviderResolutionError` with a message listing the registered provider name.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `npm run test --workspace=@poe-code/superintendent` — green.
      - `npx tsc --noEmit` — clean.
    status:
      implement: open
      test: open
      commit: open

  - id: verify-model-cli-flow
    title: Verify --model CLI flag flows through to provider resolution
    prompt: |
      The `--model` option already exists in the CLI (around `src/cli/poe-agent-main.ts:102`). Confirm the value reaches the agent builder's `.model(...)` call; wire it through if not. Then add an integration test.

      Design context: {{plan_doc}}

      ## Check

      - `src/cli/poe-agent-main.ts`: trace `--model <id>` from the option definition to where the `AgentBuilder` is configured. It must call `.model(optionValue)` on the builder. If it doesn't, wire it explicitly — do not rely on config-fallback magic when the flag is set.
      - If `agent.model` is also set in config, `--model` must override it.
      - With `--yes`, `--model` is required if no `agent.model` is configured. Surface the message documented in the plan (`"Error: --model is required in non-interactive mode..."`).

      ## Forward from superintendent runner

      `packages/superintendent/src/commands/poe-agent-runner.ts`: if the runner takes a `model` arg, ensure it flows into the builder `.model(...)` call. No silent defaults.

      ## Tests

      - Add an integration test that registers a provider plugin, requests `--model nonexistent-model`, and asserts the `ProviderResolutionError` surface message contains both the model id and the list of registered provider names.
      - Add a test that asserts `--model` (CLI) overrides `agent.model` (config) when both are present.
      - Add a `--yes` + missing `--model` + missing `agent.model` test asserting the error message.

      ## Verify

      - `npx vitest run packages/poe-agent` — all green.
      - `npm run test --workspace=@poe-code/superintendent` — green.
      - `npm run lint` — clean.
      - `npm run screenshot-poe-code -- run --help` — CLI help shows `--model`. Save screenshot for review.
    status:
      implement: open
      test: open
      commit: open

  - id: manual-qa-doc
    title: Write manual QA doc and visual verification
    prompt: |
      Final step: a markdown QA doc (no scripts) and a screenshot pass.

      Design context: {{plan_doc}}

      ## Create

      `docs/plans/qa/providers.md` — markdown-only steps an agent can execute:

      - Smoke test: `npx poe-agent run --model gpt-5-mini --prompt "Say hi"` against a real Poe key. Expected: completes without error, shows assistant text output.
      - `--model` override: set `agent.model: Claude-Sonnet-4.6` in config, then run with `--model gpt-5-mini`. Verify the run actually used `gpt-5-mini` (look at request log / usage event).
      - Missing provider match: run `npx poe-agent run --model nonexistent-model --prompt "hi"`. Verify the error message contains `"No provider supports model"`, the model id, and the registered provider names in order.
      - openai-responses reasoning round-trip: start an o-series model with a prompt that triggers tool use twice in a row. Verify reasoning refs (reasoning_details) survive the round-trip across both tool-use turns and the final response references prior reasoning correctly.
      - `poe-agent --help` screenshot: `npm run screenshot-poe-code -- --help` — confirm `--model` is listed and formatting looks right.
      - `poe-agent run --help` screenshot: `npm run screenshot-poe-code -- run --help`.

      Keep the doc tight — one numbered list of steps per scenario, with the exact command and the exact assertion. No TypeScript, no bash scripts.

      ## Final acceptance sweep

      Run these and include the results in the commit message / QA doc as confirmed:

      - `npx vitest run packages/poe-agent` — all green.
      - `npx tsc --noEmit` — clean.
      - `npm run lint` — clean.
      - `grep -R "sanitizeToolName\|INVALID_TOOL_NAME_CHAR\|originalByApiName\|createPoeAcpModel" packages/` — zero matches.
      - `test -d packages/poe-agent/src/models` — directory absent.
    status:
      implement: open
      test: open
      commit: open
---

# Context

Pipeline execution of [poe-agent-providers](./poe-agent-providers.md).

The full design doc (levels 1-5: what we're building, user-facing shape, implementation details, interfaces and test plan, code plan) is injected into every task prompt via the `plan_doc` var, so each task is self-contained and has the end-to-end context without re-pasting it here.

## Task ordering

Each task is a standalone commit. Tests must be green at every step.

1. `rename-dotted-tool-fixtures` — mechanical rename, pre-refactor.
2. `tool-names-validator` — add `assertValidToolName`, wire into registration, delete silent sanitiser.
3. `reshape-acp-core-events` — `ProviderStreamEvent` + `AcpModel` reshape + `runLoop` refactor; temporarily adapt `createPoeAcpModel` to the new shape.
4. `provider-types-resolver` — `Provider`/`ProviderContext`/`providers?:` + `resolve-provider.ts` and tests.
5. `openai-dep-auth-helper` — `openai` dependency + shared `resolveOpenaiApiKey` helper.
6. `openai-chat-completions-plugin` — first provider plugin + tests + registry entry.
7. `wire-resolve-provider-delete-models` — swap `agent.ts` to `resolveProvider`, update default bundles in `agent-session.ts` and `poe-agent-runner.ts`, delete `packages/poe-agent/src/models/`, re-export public API.
8. `openai-responses-plugin` — second provider plugin + tests + registry entry + prepend in runner chain.
9. `verify-model-cli-flow` — confirm `--model` flows end-to-end, add integration tests, screenshot CLI help.
10. `manual-qa-doc` — markdown QA doc at `docs/plans/qa/providers.md` plus final acceptance sweep.

## Stop conditions (must escalate, not push through)

- `openai` SDK surface disagrees with the plan's event mapping in the pinned version.
- A runLoop consumer depends on a removed `AcpModelResponse` field in a way not foreseen here.
- `InvalidToolNameError` fires for a real (non-fixture) tool name in production.
- An existing test fails for a reason unrelated to the refactor — do NOT skip or quarantine.
