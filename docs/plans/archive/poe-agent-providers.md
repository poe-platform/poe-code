# poe-agent providers

Turn the model layer into a plugin contribution so providers register through the same path as every other `AgentPlugin`, and the first provider whose `supports(modelId)` returns true wins.

## 1. What we're building

Redesign the poe-agent model layer into a **provider-plugin**. Concretely:

- `AgentPlugin` gains an optional contribution slot: `providers?: Provider[]`.
- A `Provider` is the declarative record `{ name, supports(modelId) → boolean, createModel(modelId, ctx) → AcpModel | Promise<AcpModel> }`.
- Providers register via the same [`builtinPluginRegistry`](packages/poe-agent/src/plugins/registry.ts) path as existing plugins — there is no parallel registry and no host-side `if/switch` keyed on provider name.
- Resolution walks the resolved `AgentPlugin[]` in plugin order, flattens their `providers` arrays in order, and picks the **first provider whose `supports(modelId)` returns `true`**. A catch-all (`supports: () => true`) is a legitimate terminal fallback.
- `ProviderContext` passed to `createModel` is `{ fetch, signal?, logger?, options }`, where `options` is the plugin's own already-parsed options (apiKey, baseUrl, etc.). Providers stay config-pure and know nothing about logging/DI concerns beyond what the context hands them.
- The selected `modelId` lives in the agent session config and is settable via the CLI `--model` flag. Providers are stateless w.r.t. selection — they only answer "do I own this id?" and "build me an `AcpModel` for it".

Migration and new providers in this plan:

- Convert [packages/poe-agent/src/models/poe.ts](packages/poe-agent/src/models/poe.ts) into [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts), contributing one provider that uses the `openai` SDK's `chat.completions.*` namespace against Poe's OpenAI-compatible endpoint.
- Delete the `packages/poe-agent/src/models/` directory once the plugin fully subsumes it.
- Add [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts), contributing a provider built on the official `openai` SDK's `responses.*` namespace. This lands in this plan so we get typed reasoning items, the full `ResponseStreamEvent` union, and a second concrete provider that exercises the contract.
- The `options.acpModel` DI escape hatch at [packages/poe-agent/src/agent.ts:228](packages/poe-agent/src/agent.ts#L228) stays — it continues to let tests and embedders inject an `AcpModel` directly, bypassing provider resolution.

Explicitly **out of scope for this plan** (intentional follow-up):

- Loading providers from external npm packages (third-party-loadable plugins). The contract is designed to allow it later; it is not wired up here.
- Migrating all other code paths (e.g. the agent-spawn session, compaction plugin) that currently take a `model` string directly — they keep the same shape; only the central provider-resolution step changes.

Registration and selection rules (decided):

- **No auto-registration of a default provider** in `@poe-code/poe-agent`. If no provider plugin is configured, model resolution throws.
- **Defaults live in the runners**. Two "runner" layers default-wire the agent and both must add provider plugins:
  1. [packages/superintendent/src/commands/poe-agent-runner.ts](packages/superintendent/src/commands/poe-agent-runner.ts) — adds `.use(openaiResponsesPlugin()).use(openaiChatCompletionsPlugin())` at the top of its `.use(...)` chain.
  2. [packages/poe-agent/src/agent-session.ts:85-90](packages/poe-agent/src/agent-session.ts#L85-L90) `createAgentSession()` default plugin bundle — currently `[systemPromptPlugin, filesPlugin, shellPlugin, webPlugin]` — must be extended to `[openaiResponsesPlugin(), openaiChatCompletionsPlugin(), systemPromptPlugin, filesPlugin, shellPlugin, webPlugin]`. Without this, every existing `createAgentSession()` caller ([src/cli/commands/agent.ts:56](src/cli/commands/agent.ts#L56), [src/providers/poe-agent.ts:608](src/providers/poe-agent.ts#L608), ~15 test call sites) would throw `ProviderResolutionError`.
- **No matching provider for a requested `modelId`** → throw at run-prepare time, listing the `name`s of registered providers.
- **Two providers registered with the same `name`** → throw at load time.
- **CLI `--model`** is in scope: the poe-agent CLI (and any runner that embeds it) must accept `--model <id>` to select the `modelId` that gets fed to provider resolution.

Model contract and ACP relationship (decided):

- The `openai` SDK becomes a **hard dependency of `@poe-code/poe-agent`**. Both providers built in this plan use it: `openai-responses` via `openai.responses.*`, `openai-chat-completions` via `openai.chat.completions.*`. Both default to Poe (`https://api.poe.com/v1` / `https://api.poe.com`); users override `baseUrl` to hit real OpenAI or any OpenAI-compatible endpoint. The existing hand-rolled fetch code in [models/poe.ts](packages/poe-agent/src/models/poe.ts) is replaced with SDK calls as part of the migration.
- The provider contract emits a **rich internal event stream, NOT ACP `SessionUpdate`**. Modeled on Zed's [`LanguageModelCompletionEvent`](https://github.com/zed-industries/zed/blob/main/crates/language_model_core/src/language_model_core.rs#L40), the union covers what ACP deliberately drops: Anthropic thinking signatures, OpenAI `ResponseReasoningItem` refs, tool-argument JSON deltas, parse-error recovery, typed usage. Tentative variants (shape firmed up in Level 4):
  - `text` — assistant message text delta
  - `thinking` — reasoning text delta, optional `signature`
  - `redacted_thinking` — opaque encrypted thinking block (Anthropic)
  - `reasoning_details` — opaque provider-specific payload for multi-turn round-trip (OpenAI Responses `ResponseReasoningItem` lives here)
  - `tool_use_delta` — tool-call id / name / arg-JSON delta
  - `tool_use_complete` — tool call finalized (args parsed)
  - `tool_use_json_parse_error` — buffered args failed to parse
  - `usage` — typed token counts (inputTokens/outputTokens/cachedTokens/cacheCreationTokens)
  - `stop` — terminal reason (end_turn, tool_use, max_tokens, etc.)
- **ACP `SessionUpdate` emission is outer-wire only.** Where poe-agent exposes itself to an ACP client, a thin projector converts the internal stream to `SessionUpdate`s from [`@poe-code/poe-acp-client`](packages/poe-acp-client/src/types.ts) — mirroring how [agent-spawn/src/acp/session-update-converter.ts](packages/agent-spawn/src/acp/session-update-converter.ts) already imports `SessionUpdate` at the boundary and converts to a simpler internal event type. Building that projector itself is out of scope for this plan; the provider stream is defined so it can feed one later.
- `AcpModelResponse` in [packages/poe-agent/src/runtime/acp-core.ts](packages/poe-agent/src/runtime/acp-core.ts) gets reshaped: `deltas: AsyncIterable<string>` + loose `message/toolCalls/usage` fields are replaced by `events: AsyncIterable<ProviderStreamEvent>`. The `runLoop` dispatcher becomes a single `for await` on events with zero provider-name branching.

Constraints carried from CLAUDE.md:

- Providers must be **declarative and minimal** — no repeated information that can be inferred.
- **No `if/case` branching on provider name** in host code — the registry walk is generic.
- **TDD is required** for code changes in this plan.

## 2. User-facing shape

### Programmatic (agent builder)

Providers register via `.use(...)` exactly like every other plugin. Registration order = resolution priority; the first provider whose `supports(modelId)` returns true wins.

```ts
import { agent } from "@poe-code/poe-agent";
import { openaiChatCompletionsPlugin, openaiResponsesPlugin } from "@poe-code/poe-agent/plugins";

// Default: both plugins target Poe. "Just works" for a Poe agent.
const result = await agent()
  .model("gpt-5")
  .use(openaiResponsesPlugin())
  .use(openaiChatCompletionsPlugin())
  .use(systemPromptPlugin())
  .use(filesPlugin({ cwd }))
  .run({ prompt: "Summarise README" });

// Override to hit real OpenAI instead of Poe for Responses calls:
agent()
  .model("gpt-5")
  .use(openaiResponsesPlugin({
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
  }))
  .use(openaiChatCompletionsPlugin());
```

Plugin option shape (standard OpenAI-SDK params, Poe-pointing defaults):

```ts
type OpenaiResponsesPluginOptions = {
  baseUrl?: string;          // default "https://api.poe.com/v1"
  apiKey?: string;           // default: auth-store lookup (same as openaiChatCompletionsPlugin)
  organization?: string;     // passthrough to openai SDK
  project?: string;          // passthrough to openai SDK
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  reasoningSummary?: "auto" | "concise" | "detailed";
};

type OpenaiChatCompletionsPluginOptions = {
  baseUrl?: string;          // default "https://api.poe.com/v1"
  apiKey?: string;           // default: auth-store lookup
  organization?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
};
```

- Both plugins share the `openai` SDK internally, so they accept the same constructor-style options.
- `openaiResponsesPlugin` contributes a provider with `supports: (id) => id.startsWith("gpt-") || /^o\d/.test(id)` — OpenAI-origin models where the Responses API is meaningful. Poe relays these to OpenAI upstream.
- `openaiChatCompletionsPlugin` contributes a provider with `supports: () => true` (catch-all via chat/completions), so non-OpenAI models on Poe (`Claude-Sonnet-4.6`, `Llama-3.1-405b`, etc.) resolve here.
- The existing `options.acpModel` escape hatch on `AgentBuilder.run(...)` is unchanged — passing a ready-made `AcpModel` bypasses provider resolution entirely.

### Config file (matches existing `agent.plugins` array)

Provider plugins register through the same `builtinPluginRegistry` path, so they appear in the same config slot as other plugins. No separate `agent.providers` key.

```yaml
agent:
  model: gpt-5
  plugins:
    - name: openai-responses
      # baseUrl defaults to https://api.poe.com/v1
      # apiKey resolved from auth-store if omitted
      options:
        reasoningEffort: medium
    - name: openai-chat-completions
      # baseUrl defaults to https://api.poe.com/v1
      options: {}
    - name: system-prompt
    - name: files
      options:
        cwd: .
```

### CLI `--model`

```sh
poe-agent run --model gpt-5-mini --prompt "explain foo.ts"
```

- `--model <id>` sets the session-level `modelId` that drives provider resolution. Overrides `agent.model` in the config file.
- With `--yes`, `--model` is required if no `agent.model` is set in config (no silent default).

### Error output

**Unknown model (no provider matches):**

```text
Error: No provider supports model "some-unknown-model".
Registered providers (in order): openai-responses, openai-chat-completions.
Check --model or agent.plugins config, or add a provider plugin that matches.
```

**Duplicate provider name at load:**

```text
Error: agent.plugins contributed two providers named "openai-responses".
Providers must have unique names. Offending plugin entries:
  - agent.plugins[0] (openai-responses-plugin)
  - agent.plugins[2] (custom-openai-plugin)
```

**`--model` missing with `--yes`:**

```text
Error: --model is required in non-interactive mode (--yes) and no agent.model is configured.
```

### New public types (exported from `@poe-code/poe-agent`)

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
  options: unknown;          // provider's own already-parsed plugin options
};

// AgentPlugin extension
export type AgentPlugin = {
  // ...existing fields
  providers?: Provider[];
};

export type ProviderStreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "reasoning_details"; payload: unknown }           // opaque round-trip
  | { type: "tool_use_delta"; id: string; name?: string; argsDelta?: string }
  | { type: "tool_use_complete"; id: string; name: string; args: unknown }
  | { type: "tool_use_json_parse_error"; id: string; raw: string; error: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens: number; cacheCreationTokens: number }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "max_tokens" | "error" };
```

`AcpModelResponse` shrinks to:

```ts
export type AcpModelResponse = {
  events: AsyncIterable<ProviderStreamEvent>;
};
```

The current `message/content/toolCalls/usage/deltas` fields on `AcpModelResponse` are derived inside `runLoop` from the event stream, not produced by providers.

### Runner default wiring ([poe-agent-runner.ts](packages/superintendent/src/commands/poe-agent-runner.ts))

```ts
const builder = agent()
  .model(model)
  .use(openaiResponsesPlugin())      // picks gpt-*, o-series
  .use(openaiChatCompletionsPlugin())                   // catch-all
  .use(systemPromptPlugin())
  .use(filesPlugin({ cwd: input.cwd }))
  // ...rest unchanged
```

Order is fixed in the runner so superintendent's behaviour is deterministic regardless of which model the user picks.

## 3. Implementation details and technical decisions

### Architecture

- **Contract types** (`Provider`, `ProviderContext`, `ProviderStreamEvent`) live in [packages/poe-agent/src/runtime/plugin-types.ts](packages/poe-agent/src/runtime/plugin-types.ts) next to `AgentPlugin`, which gets the new optional `providers?: Provider[]` field.
- **Resolution** is a new, generic helper `resolveProvider(plugins, modelId)` that walks `AgentPlugin[]` in config order, flattens `providers`, short-circuits on the first `supports(id) === true`. It is called exactly once from [agent.ts:229](packages/poe-agent/src/agent.ts#L229), replacing the current hard-coded `createPoeAcpModel(...)` call. Zero callers branch on provider name.
- **Duplicate-name check** runs during setup (after all plugins are instantiated, before `resolveProvider` is ever invoked) — a single pass over the flattened provider list throws `ProviderConfigError` if a `name` repeats.
- **`AcpModel` contract** in [packages/poe-agent/src/runtime/acp-core.ts](packages/poe-agent/src/runtime/acp-core.ts) becomes `{ complete(request) → Promise<{ events: AsyncIterable<ProviderStreamEvent> }> }`. `runLoop` consumes the event stream via one `for await`, with a small event-accumulator that reconstructs the final `ChatMessage` (text, reasoning-metadata refs, tool calls) to push into `runContext.messages`. No legacy string fields on `AcpModelResponse`.
- **Plugin files**:
  - [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts) — uses `new OpenAI({ baseURL, apiKey, ... }).chat.completions.create({ stream: true, ... })`, maps `ChatCompletionChunk` deltas to `ProviderStreamEvent`.
  - [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts) — uses `new OpenAI(...).responses.stream({ model, input, reasoning, tools, ... })`, maps `ResponseStreamEvent` variants to `ProviderStreamEvent`.
- Both plugin files expose: `export const spec: PluginSpec<Options>` (registered in [registry.ts](packages/poe-agent/src/plugins/registry.ts)) and `export function openaiResponsesPlugin(opts?)` / `export function openaiChatCompletionsPlugin(opts?)` factories that return an `AgentPlugin` with a populated `providers: [Provider]`.
- **Delete** `packages/poe-agent/src/models/` directory after migration; update all imports of `createPoeAcpModel` / `PoeFetchFn` (call sites identified above — `agent.ts:2,229`; tests in `models/poe.test.ts` move to `plugins/poe-agent-plugin-openai-chat-completions.test.ts`).
- **Tool-arg buffering** happens inside each provider: providers collect JSON-arg deltas into a buffer keyed by tool-call id and emit `tool_use_complete` (with parsed args) or `tool_use_json_parse_error` at boundary events (`response.output_item.done` for Responses, final chunk for chat/completions). `runLoop` never parses tool JSON itself.

### Edge cases

- **Abort mid-stream** — `ProviderContext.signal` is wired to the openai SDK's `{ signal }` request option; the SDK cancels the fetch, the async iterator throws `AbortError`, `runLoop` propagates the existing `AbortError` handling.
- **openai SDK error** (4xx/5xx, network) — provider lets it bubble as `APIError` from the SDK; `runLoop` wraps it into the existing error path. Retries are the SDK's responsibility via `maxRetries` option (default 2 from the SDK).
- **Missing apiKey** — providers call the shared `resolveApiKey(options.apiKey)` helper (lifted from current [models/poe.ts:213](packages/poe-agent/src/models/poe.ts#L213) into `packages/poe-agent/src/plugins/openai-auth.ts`), which falls back to auth-store lookup and throws with the existing `"run 'poe-code login'"` message. Shared between both providers.
- **Tool-call JSON never closes** (stream ends mid-delta) — emit `tool_use_json_parse_error` with accumulated raw; `runLoop` surfaces it as a tool error via the existing tool-error path.
- **Reasoning-only response (no text, no tool calls)** — valid for o-series when `reasoning.effort` is high; `runLoop`'s no-tool-call termination path writes an empty-content assistant message with the reasoning-details preserved on the `ChatMessage` for round-trip.
- **`supports(id)` throws** — caught at resolution, converted to `ProviderConfigError` naming the plugin. Non-propagating.
- **First-matching-provider createModel throws** — propagates; we do NOT fall through to the next provider. Rationale: a provider that claimed to support the id and then failed to construct is a hard error, not a fallback signal.
- **Empty `providers` array on a plugin** — legal (plugin might only contribute tools/hooks). Ignored by the resolver.
- **Tool name validation (replaces silent sanitisation).** [models/poe.ts:151-154](packages/poe-agent/src/models/poe.ts#L151-L154) currently sanitises tool names silently via `/[^a-zA-Z0-9_-]/g` and book-keeps the rewrite in `originalByApiName` (lines 25-32). This only exists to defend against dotted tool names in test fixtures — no production tool uses dots. Changes in this plan:
  - Rename the offending test fixtures to underscored names (`tools.initial` → `tools_initial`, `repo.search` → `repo_search`, `superintendent-tools.workflow_transition` → `superintendent_tools_workflow_transition`, etc.) in [agent.test.ts](packages/poe-agent/src/agent.test.ts), [agent.runtime.e2e.test.ts](packages/poe-agent/src/agent.runtime.e2e.test.ts), [runtime.test.ts](packages/poe-agent/src/runtime/runtime.test.ts), [plugin-api-impl.test.ts](packages/poe-agent/src/runtime/plugin-api-impl.test.ts), [plugins.test.ts](packages/poe-agent/src/plugins/plugins.test.ts), and any other dotted fixtures that Level 5 turns up.
  - Delete the silent sanitiser and the `originalByApiName` round-trip.
  - **Add a validator at tool-registration time** that throws `InvalidToolNameError` when a contributed tool's name does not match `/^[a-zA-Z0-9_-]+$/`. Runs in the single central tool-registration path (`PluginApi.addTool` / builder `.tools(...)`). Fails fast at plugin setup with a message that points at the offending plugin + name, not at request time.
  - Providers pass tool names through verbatim. MCP, skill, and other indirect tool sources funnel through the same validated registration path; no provider-side regex remains.

### Config, flags, env vars

- **Config knob**: `agent.model` (existing) — the default `modelId` when `--model` isn't passed.
- **CLI flag**: `--model <id>` (new) — overrides `agent.model`. Wired in the poe-agent CLI and forwarded by the superintendent runner.
- **Env vars** (all already used, just documenting what providers honour):
  - `POE_AUTH_BACKEND` (existing, via `createSecretStore`) — controls auth-store backend.
  - Both providers honour the `openai` SDK's own env lookups: `OPENAI_API_KEY`, `OPENAI_ORGANIZATION`, `OPENAI_PROJECT`, `OPENAI_BASE_URL` **only when no explicit `apiKey`/`baseUrl` option is passed** (let the SDK do its default resolution). This gives real-OpenAI users a zero-config path without conflicting with the Poe auth-store flow.
- **No new feature flags.** This is a contract refactor; behaviour doesn't gate on flags.

### Dependencies

- Add `openai` (current major, pinned to the same version across the monorepo) to `packages/poe-agent/package.json` `dependencies`. Root [package.json](package.json) adds it to the workspace hoisting dependencies as usual.
- No new workspace package created in this plan (ACP projector is out of scope; if it lands later it would consume existing `@poe-code/poe-acp-client` types).

### Resolved decisions

- **Responses `include`** defaults to `["reasoning.encrypted_content"]` so OpenAI o-series reasoning refs round-trip on multi-turn. Configurable via `OpenaiResponsesPluginOptions.include?: string[]` (passthrough to the SDK).
- **`ProviderContext.logger`** reuses the existing runtime logger type (imported from the same place other plugins get it). We accept the coupling for now; extracting a `Logger` interface into its own package is a possible follow-up, not a blocker.
- **`--model` is a per-command flag** (e.g. `poe-agent run --model <id>`), not a global flag. Fits the existing command structure.
- **Tool-name sanitisation is unconditional** in both providers — confirmed necessary because routine tool names in the repo contain `.` (e.g. `tools.initial`, `superintendent-tools.workflow_transition`, `custom.tool`), which OpenAI + Poe both reject. Shared helper in `packages/poe-agent/src/plugins/openai-tool-names.ts`.

## 4. Interfaces and test plan

### Module boundaries (function signatures that cross packages or layers)

**Contract types** — `packages/poe-agent/src/runtime/plugin-types.ts`:

```ts
export type Provider = {
  name: string;
  supports(modelId: string): boolean;
  createModel(modelId: string, ctx: ProviderContext): AcpModel | Promise<AcpModel>;
};

export type ProviderContext = {
  fetch: typeof fetch;
  signal?: AbortSignal;
  logger?: Logger;                // existing runtime Logger type
  options: unknown;               // plugin's own parsed options
};

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

export type AgentPlugin = { /* existing */ providers?: Provider[] };
```

**Model contract** — `packages/poe-agent/src/runtime/acp-core.ts`:

```ts
export type AcpModel = {
  complete(request: {
    messages: AcpModelRequestMessage[];
    tools: AcpModelToolDefinition[];
    signal: AbortSignal;
  }): Promise<{ events: AsyncIterable<ProviderStreamEvent> }>;
};
```

**Resolution** — new file `packages/poe-agent/src/runtime/resolve-provider.ts`:

```ts
export class ProviderResolutionError extends Error {}
export class DuplicateProviderNameError extends Error {}

export function collectProviders(plugins: AgentPlugin[]): Provider[];            // flattens + throws on dup names
export function resolveProvider(providers: Provider[], modelId: string): Provider;
```

**Tool-name validator** — new file `packages/poe-agent/src/runtime/tool-names.ts`:

```ts
export class InvalidToolNameError extends Error {}
export const TOOL_NAME_PATTERN: RegExp;                                          // /^[a-zA-Z0-9_-]+$/
export function assertValidToolName(name: string, contributor?: string): void;   // throws on invalid
```

Called from `PluginApi.addTool` impl in [runtime/plugin-api-impl.ts](packages/poe-agent/src/runtime/plugin-api-impl.ts) and the builder `.tools(...)` path in [agent.ts](packages/poe-agent/src/agent.ts).

**Plugin specs** — `packages/poe-agent/src/plugins/registry.ts`:

```ts
import { spec as openaiChatCompletionsSpec } from "./poe-agent-plugin-openai-chat-completions.js";
import { spec as openaiResponsesSpec } from "./poe-agent-plugin-openai-responses.js";

// added to builtinPluginRegistry alongside existing entries
```

**Plugin factories** — exports from `@poe-code/poe-agent/plugins`:

```ts
export function openaiChatCompletionsPlugin(opts?: OpenaiChatCompletionsPluginOptions): AgentPlugin;
export function openaiResponsesPlugin(opts?: OpenaiResponsesPluginOptions): AgentPlugin;

// each returns { name: "<provider-name>-plugin", providers: [Provider] }
```

### Test strategy

All tests use vitest. Speed rule: every test mocks the `openai` SDK; no real network.

**Unit — `resolve-provider.test.ts`:**

- first-match-wins when two providers both `supports(id)`
- `ProviderResolutionError` thrown, error lists registered names in order
- `DuplicateProviderNameError` thrown at collection if two plugins register the same provider `name`
- empty `providers` array on a plugin is ignored
- `supports()` throwing is caught and wrapped with provider name
- `createModel()` throwing propagates (no fall-through to next provider) — test asserts no second provider is consulted

**Unit — `tool-names.test.ts`:**

- valid names pass (`foo`, `foo_bar`, `foo-bar`, `Foo123`)
- invalid names throw (`foo.bar`, `foo bar`, `foo/bar`, empty string)
- error message includes contributor when provided

**Unit — `poe-agent-plugin-openai-chat-completions.test.ts`** (replaces current `models/poe.test.ts`):

- maps streaming `ChatCompletionChunk.delta.content` → `text` events
- maps streaming `delta.tool_calls[].function.arguments` → `tool_use_delta` events; final chunk emits `tool_use_complete` with parsed args
- malformed tool-call JSON at stream end → `tool_use_json_parse_error`
- maps final `chunk.usage` → `usage` event (prompt/completion tokens, cached, cache_creation)
- auth-store fallback when `apiKey` option omitted
- aborted stream propagates `AbortError`
- tool-name validation is NOT in the provider (covered by the tool-names tests); provider passes names through

**Unit — `poe-agent-plugin-openai-responses.test.ts`:**

- `response.output_text.delta` → `text`
- `response.reasoning_summary_text.delta` → `thinking`
- `response.output_item.done` for reasoning items → `reasoning_details` (opaque passthrough of the item)
- tool-call sequence: `response.output_item.added` (function_call) → `tool_use_delta`, each `response.function_call_arguments.delta` → `tool_use_delta`, `response.output_item.done` → `tool_use_complete`
- `response.completed` with usage → `usage` event
- `response.error` → propagates error
- `include` defaults to `["reasoning.encrypted_content"]`; overridable via options
- `reasoningEffort` / `reasoningSummary` options thread into `reasoning` request param

**Unit — `acp-core.test.ts` (existing file, extended):**

- event-stream reconstructor: `text` events join into final message content
- `tool_use_complete` events accumulate into `tool_calls` on the emitted `ChatMessage`
- `thinking` / `reasoning_details` events preserved on the outgoing `ChatMessage` for round-trip
- `usage` events emit on the `runLoop` event stream exactly once per iteration
- no-tool-call termination works for reasoning-only responses

**Unit — `registry.test.ts` (existing file, extended):**

- both new plugin specs resolve from `agent.plugins: [{ name: "openai-responses" }, { name: "openai-chat-completions" }]`
- options parsing for each plugin

**Integration — `agent.test.ts` (existing file, targeted additions):**

- registering both providers + requesting a `gpt-*` modelId routes to `openai-responses`
- registering both + requesting a non-matching modelId routes to the catch-all `openai-chat-completions`
- registering only `openai-responses` + requesting `Claude-Sonnet-4.6` throws `ProviderResolutionError`
- `options.acpModel` DI still bypasses resolution

**Manual QA (markdown — docs/plans/qa/providers.md, new):**

- steps to verify the CLI `--model` flag against a real Poe key
- screenshot check of `poe-agent run --model gpt-5-mini --prompt "..."` output
- steps to verify openai-responses reasoning round-trip across two consecutive tool-use turns with an o-series model

### Rollout / migration steps

1. Rename dotted tool names in test fixtures (single commit, pre-refactor so tests stay green as the sanitiser is removed).
2. Add `ProviderStreamEvent` + reshape `AcpModel` / `AcpModelResponse` in [runtime/acp-core.ts](packages/poe-agent/src/runtime/acp-core.ts); update `runLoop` to consume events. Existing `createPoeAcpModel` temporarily adapted to the new shape to keep tests green.
3. Add `tool-names.ts` validator; wire into `PluginApi.addTool` and builder `.tools(...)`. Delete the `sanitizeToolName` regex + `originalByApiName` round-trip.
4. Add `resolve-provider.ts`; extend `AgentPlugin` with `providers?: Provider[]`.
5. Introduce `poe-agent-plugin-openai-chat-completions.ts` (functionally equivalent to current Poe provider but using `openai` SDK and emitting `ProviderStreamEvent`s); register in `builtinPluginRegistry`.
6. Swap [agent.ts:229](packages/poe-agent/src/agent.ts#L229) `createPoeAcpModel(...)` call for `resolveProvider(collectProviders(plugins), modelName).createModel(...)`. Delete `packages/poe-agent/src/models/` directory.
7. Introduce `poe-agent-plugin-openai-responses.ts`; register in `builtinPluginRegistry`.
8. Add `--model` CLI flag to the poe-agent `run` command and forward it from the superintendent runner.
9. Update [poe-agent-runner.ts](packages/superintendent/src/commands/poe-agent-runner.ts) to wire `.use(openaiResponsesPlugin()).use(openaiChatCompletionsPlugin())` into the default plugin set.
10. Add `openai` to `packages/poe-agent/package.json` dependencies.

Each step is a standalone commit keeping tests green; steps 2–6 together replicate current behaviour via the new contract before step 7 introduces new capability.

### Autonomy checklist

**Acceptance criteria (agent-checkable):**

- `npx vitest run packages/poe-agent` — all green, including new test files above.
- `npx tsc -p packages/poe-agent/tsconfig.json --noEmit` — clean.
- `grep -R "sanitizeToolName\|INVALID_TOOL_NAME_CHAR\|originalByApiName" packages/` — zero matches.
- `test -d packages/poe-agent/src/models` — directory absent.
- `npm run lint --workspace=@poe-code/poe-agent` — clean.
- `npm run test --workspace=@poe-code/superintendent` — green (runner wiring).
- `npx poe-agent run --model gpt-5-mini --prompt "echo test"` — completes without error against real Poe key.

**Verification commands (run in order):**

1. `npx vitest run packages/poe-agent` — test pass
2. `npx tsc --noEmit` (monorepo-wide) — type clean
3. `npm run lint` — lint clean
4. `npm run screenshot-poe-code -- run --help` — CLI help shows `--model` (screenshot saved for review)
5. `npx poe-agent run --model gpt-5-mini --prompt "Say hi"` (smoke)
6. `npx poe-agent run --model nonexistent-model --prompt "hi"` — asserts the `ProviderResolutionError` surface message

**Fixtures / environment:**

- No new on-disk fixtures. openai SDK is mocked per-test with `vi.mock("openai", () => ...)`.
- Requires `POE_API_KEY` for smoke test only (already in dev setup).

**Decisions already made:**

- `Provider` / `ProviderContext` / `ProviderStreamEvent` shapes (Level 2 + 4).
- Tool-name pattern `/^[a-zA-Z0-9_-]+$/` and throw-on-invalid policy.
- `openaiResponsesPlugin` `supports`: `id.startsWith("gpt-") || /^o\d/.test(id)`.
- `openaiChatCompletionsPlugin` `supports`: `() => true`.
- Both plugins default `baseUrl` to Poe; `apiKey` falls back to auth-store.
- Responses `include` defaults to `["reasoning.encrypted_content"]`.

**Decisions the agent may make autonomously:**

- Internal helper function names and file organisation within a plugin.
- Test structure and individual test names (as long as the acceptance-criteria test files exist).
- Choice between `openai.beta.chat.completions.stream` and `openai.chat.completions.create({ stream: true })` — whichever cleanly yields a typed async iterator.
- Exact error-message wording (must include provider name and model id where relevant).

**Stop conditions (must escalate, not push through):**

- openai SDK surface disagrees with the plan's event mapping (e.g. `response.reasoning_summary_text.delta` is renamed in the pinned SDK version). Pause and report the SDK version plus the observed shape.
- A runLoop consumer (hook, plugin) depends on a removed `AcpModelResponse` field in a way not foreseen in this plan. Pause — may need contract revision.
- `InvalidToolNameError` fires for a real (non-fixture) tool name — means a production tool uses invalid chars; stop and list the offender.
- An existing test fails for a reason unrelated to the refactor (pre-existing flake). Do NOT skip or quarantine. Stop and report.

## 5. Code plan

### Files to create

- [packages/poe-agent/src/runtime/tool-names.ts](packages/poe-agent/src/runtime/tool-names.ts)
  - `export const TOOL_NAME_PATTERN: RegExp` (= `/^[a-zA-Z0-9_-]+$/`)
  - `export class InvalidToolNameError extends Error`
  - `export function assertValidToolName(name: string, contributor?: string): void`
- [packages/poe-agent/src/runtime/tool-names.test.ts](packages/poe-agent/src/runtime/tool-names.test.ts) — validator unit tests (valid/invalid names, contributor in error message).
- [packages/poe-agent/src/runtime/resolve-provider.ts](packages/poe-agent/src/runtime/resolve-provider.ts)
  - `export class ProviderResolutionError extends Error`
  - `export class DuplicateProviderNameError extends Error`
  - `export function collectProviders(plugins: AgentPlugin[]): Provider[]`
  - `export function resolveProvider(providers: Provider[], modelId: string): Provider`
- [packages/poe-agent/src/runtime/resolve-provider.test.ts](packages/poe-agent/src/runtime/resolve-provider.test.ts) — order, first-match, dup-name, `supports` throws caught, `createModel` throws propagates, empty arrays ignored.
- [packages/poe-agent/src/plugins/openai-auth.ts](packages/poe-agent/src/plugins/openai-auth.ts) — shared helper lifted from [models/poe.ts:213](packages/poe-agent/src/models/poe.ts#L213).
  - `export async function resolveOpenaiApiKey(explicit: string | undefined): Promise<string>`
- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts)
  - `export type OpenaiChatCompletionsPluginOptions = { ... }` (as drafted in Level 2)
  - `export const spec: PluginSpec<OpenaiChatCompletionsPluginOptions>` (`name: "openai-chat-completions"`)
  - `export function openaiChatCompletionsPlugin(opts?): AgentPlugin`
  - internal: `createOpenaiChatCompletionsModel(modelId, ctx): AcpModel` using `new OpenAI({ baseURL, apiKey, ... }).chat.completions.create({ stream: true, ... })` and an async generator that maps `ChatCompletionChunk` → `ProviderStreamEvent`.
- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.test.ts) — replaces [models/poe.test.ts](packages/poe-agent/src/models/poe.test.ts) with event-stream-oriented assertions.
- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts)
  - `export type OpenaiResponsesPluginOptions = { ... }` (as drafted in Level 2)
  - `export const spec: PluginSpec<OpenaiResponsesPluginOptions>` (`name: "openai-responses"`)
  - `export function openaiResponsesPlugin(opts?): AgentPlugin`
  - internal: `createOpenaiResponsesModel(modelId, ctx): AcpModel` using `openai.responses.stream({ ... })` mapping `ResponseStreamEvent` → `ProviderStreamEvent`.
- [packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.test.ts) — reasoning deltas, reasoning_details round-trip, tool-call event translation, `include`/`reasoningEffort`/`reasoningSummary` wiring.
- [docs/plans/qa/providers.md](docs/plans/qa/providers.md) — manual QA steps for `--model`, openai-responses reasoning round-trip across tool-use turns, and screenshot of `poe-agent --help`.

### Files to change

- [packages/poe-agent/src/runtime/plugin-types.ts](packages/poe-agent/src/runtime/plugin-types.ts)
  - Add: `Provider`, `ProviderContext`, `ProviderStreamEvent` types.
  - Extend `AgentPlugin` with `providers?: Provider[]`.
- [packages/poe-agent/src/runtime/acp-core.ts](packages/poe-agent/src/runtime/acp-core.ts)
  - Replace `AcpModelResponse` (message/content/toolCalls/usage/deltas) with `{ events: AsyncIterable<ProviderStreamEvent> }`.
  - Refactor `runLoop` to consume `events` via one `for await`, accumulate into the outgoing `ChatMessage` (text, reasoning metadata, tool_calls), and emit the existing `AcpEvent` stream (`message.delta`, `usage`, `tool.intent`) from accumulated events.
  - Remove `normalizeModelResponse` / `fromOpenAiToolCalls` helpers (dead once providers emit `ProviderStreamEvent` directly).
- [packages/poe-agent/src/runtime/plugin-api-impl.ts](packages/poe-agent/src/runtime/plugin-api-impl.ts)
  - Call `assertValidToolName(tool.name, pluginName)` at the top of `addTool`.
- [packages/poe-agent/src/agent.ts](packages/poe-agent/src/agent.ts)
  - Remove `import { createPoeAcpModel, type PoeFetchFn } from "./models/poe.js";` (line 2).
  - Replace the `createPoeAcpModel(...)` call (lines 227-234) with:
    ```ts
    const providers = collectProviders(plugins);
    const provider = resolveProvider(providers, modelName);
    const model = options.acpModel ?? await provider.createModel(modelName, providerContext);
    ```
  - Validate tool names contributed via builder `.tools(...)` through `assertValidToolName`.
- [packages/poe-agent/src/plugins/registry.ts](packages/poe-agent/src/plugins/registry.ts)
  - Add imports for `openaiChatCompletionsSpec` and `openaiResponsesSpec`; register both in `builtinPluginRegistry`.
- [packages/poe-agent/src/index.ts](packages/poe-agent/src/index.ts)
  - Re-export `openaiChatCompletionsPlugin`, `openaiResponsesPlugin`, `Provider`, `ProviderContext`, `ProviderStreamEvent`, `InvalidToolNameError`, `ProviderResolutionError`, `DuplicateProviderNameError`.
- [packages/poe-agent/package.json](packages/poe-agent/package.json)
  - Add `"openai": "^<current-stable>"` to `dependencies`.
  - Audit if `auth-store` should still be a dep (yes — shared helper `openai-auth.ts` uses it).
- [packages/superintendent/src/commands/poe-agent-runner.ts](packages/superintendent/src/commands/poe-agent-runner.ts)
  - Add imports for `openaiResponsesPlugin`, `openaiChatCompletionsPlugin`.
  - Insert `.use(openaiResponsesPlugin())` and `.use(openaiChatCompletionsPlugin())` at the top of the plugin chain, before `systemPromptPlugin()`.
- [packages/poe-agent/src/agent-session.ts](packages/poe-agent/src/agent-session.ts)
  - Extend the default plugin bundle at lines 85-90 to prepend `openaiResponsesPlugin()` and `openaiChatCompletionsPlugin()`. Without this, `createAgentSession()` callers crash when no explicit `plugins` / `pluginsConfig` is passed.
  - Import the two plugin factories from `./plugins/...`.
- [packages/poe-agent/README.md](packages/poe-agent/README.md) (line 123)
  - Update the documented default bundle to list the two provider plugins first.
- [src/cli/poe-agent-main.ts](src/cli/poe-agent-main.ts)
  - No change to the `--model` option itself (it already exists at line 102). Verify the value flows into the agent builder's `.model(...)` call in this file's downstream logic. If not, wire it through.
- Test-fixture renames (mechanical, pre-refactor commit):
  - [packages/poe-agent/src/agent.test.ts](packages/poe-agent/src/agent.test.ts) — `memory.save`→`memory_save`, `web.search`→`web_search`, `doc.write`→`doc_write`, `alpha.tool`→`alpha_tool`, `beta.tool`→`beta_tool`, `schema.tool`→`schema_tool`, `repo.search`→`repo_search`.
  - [packages/poe-agent/src/agent.runtime.e2e.test.ts](packages/poe-agent/src/agent.runtime.e2e.test.ts) — `tools.initial`→`tools_initial`, `tools.leaked`→`tools_leaked`, `tools.alpha`→`tools_alpha`, `tools.beta`→`tools_beta`, `tools.fail`→`tools_fail`.
  - [packages/poe-agent/src/runtime/runtime.test.ts](packages/poe-agent/src/runtime/runtime.test.ts) — `tool.a`→`tool_a`, `search.web`→`search_web`, `repo.search`→`repo_search`, `internal.audit`→`internal_audit`, `git.status`→`git_status`, `mcp-server.status`→`mcp-server_status`.
  - [packages/poe-agent/src/runtime/plugin-api-impl.test.ts](packages/poe-agent/src/runtime/plugin-api-impl.test.ts) — `custom.tool`→`custom_tool`, `alpha.static`→`alpha_static`, `alpha.dynamic`→`alpha_dynamic`.
  - [packages/poe-agent/src/plugins/plugins.test.ts](packages/poe-agent/src/plugins/plugins.test.ts) — `repo.search`→`repo_search`.

### Files to delete

- [packages/poe-agent/src/models/poe.ts](packages/poe-agent/src/models/poe.ts)
- [packages/poe-agent/src/models/poe.test.ts](packages/poe-agent/src/models/poe.test.ts)
- `packages/poe-agent/src/models/` (directory)

### Ordering (each step = one commit, tests green at every step)

1. **Rename dotted test fixtures** (mechanical). No new code. Existing sanitiser still silently handles production — the rename just means the sanitiser has nothing left to sanitise.
2. **Add `tool-names.ts` + tests; wire `assertValidToolName` into `PluginApi.addTool` and builder `.tools(...)`**; delete the `sanitizeToolName` regex and `originalByApiName` book-keeping in [models/poe.ts](packages/poe-agent/src/models/poe.ts).
3. **Reshape `AcpModel` / `AcpModelResponse` in [runtime/acp-core.ts](packages/poe-agent/src/runtime/acp-core.ts)**; update `runLoop`; temporarily adapt `createPoeAcpModel` in [models/poe.ts](packages/poe-agent/src/models/poe.ts) to emit `ProviderStreamEvent`s so existing tests pass. Add `runtime/acp-core` event-reconstruction tests.
4. **Add `Provider`/`ProviderContext`/`providers?:` to plugin-types**; add `resolve-provider.ts` + tests. Not yet wired from `agent.ts`.
5. **Add `openai` to [packages/poe-agent/package.json](packages/poe-agent/package.json)**; add shared `openai-auth.ts`.
6. **Create [poe-agent-plugin-openai-chat-completions.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts) + tests**; register in `builtinPluginRegistry`.
7. **Swap [agent.ts:229](packages/poe-agent/src/agent.ts#L229) to `resolveProvider(...)`**; update [poe-agent-runner.ts](packages/superintendent/src/commands/poe-agent-runner.ts) to `.use(openaiChatCompletionsPlugin())`. Delete [packages/poe-agent/src/models/](packages/poe-agent/src/models/). Re-export new public API from [index.ts](packages/poe-agent/src/index.ts).
8. **Create [poe-agent-plugin-openai-responses.ts](packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts) + tests**; register in `builtinPluginRegistry`; `.use(openaiResponsesPlugin())` first in runner chain.
9. **Verify `--model` CLI flow** in [src/cli/poe-agent-main.ts](src/cli/poe-agent-main.ts); add integration test for `--model nonexistent-model` producing the `ProviderResolutionError` message.
10. **Write manual QA** in [docs/plans/qa/providers.md](docs/plans/qa/providers.md); take `npm run screenshot-poe-code -- --help` for visual verification.

After step 10: `grep -R "sanitizeToolName\|INVALID_TOOL_NAME_CHAR\|originalByApiName\|createPoeAcpModel" packages/` must return zero matches, and `test -d packages/poe-agent/src/models` must fail (directory gone).
