---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

steps:
  manual:
    prompt: |
      Perform this manual validation with terminal-pilot. Exercise success,
      failure, cancellation, and repeat-run behavior where applicable. Fix
      any bugs exposed by validation, then record the result without exposing
      credentials.

      {{prompt}}

tasks:
  - id: add-gemini-cli-agent-def
    title: Add gemini-cli agent definition
    prompt: |
      Create `packages/agent-defs/src/agents/gemini-cli.ts` declaring:

      ```ts
      export const geminiCliAgent: AgentDefinition = {
        id: "gemini-cli",
        name: "gemini-cli",
        aliases: ["gemini"],
        label: "Gemini CLI",
        summary: "Configure Google's Gemini CLI to use a compatible Google generations API.",
        binaryName: "gemini",
        configPath: "~/.gemini/settings.json",
        apiShapes: ["google-generations"],
        branding: {
          colors: { dark: "#8AB4F8", light: "#1A73E8" }
        }
      };
      ```

      Export from `packages/agent-defs/src/index.ts`. Add `packages/agent-defs/src/agents/gemini-cli.test.ts` asserting the declared `apiShapes` is exactly `["google-generations"]` and update registry tests to assert `resolveAgentId("gemini") === "gemini-cli"` case-insensitively.

      Backwards-compat invariant: adding this agent must not affect any existing `configure <agent> --yes` snapshots.
    status:
      implement: done
      test: done
      commit: done

  - id: dynamic-model-choices
    title: Allow async resolver for configurePrompts.model.choices
    prompt: |
      Today `configurePrompts.model.choices` is a static `{ title, value }[]` (see `src/cli/prompts.ts:9-12` and every provider that defines it, e.g. `src/providers/codex.ts:158-161`). Gemini CLI needs to fetch its model list from the active provider's `google-generations` endpoint at configure time.

      Extend the type to accept either the existing static array OR an async resolver:

      ```ts
      type ModelChoice = { title: string; value: string };
      type ModelChoices =
        | ReadonlyArray<ModelChoice>
        | ((ctx: { httpClient: HttpClient; provider: ActiveProvider; env: CliEnvironment }) => Promise<ReadonlyArray<ModelChoice>>);
      ```

      In `src/cli/commands/configure-payload.ts` (the path that today calls `resolveModel()` at line ~49), resolve the choices before prompting:
      - If `choices` is an array → use as-is.
      - If `choices` is a function → call it with an injected `httpClient` plus the already-resolved `ActiveProvider`. Cache the resolved array for the duration of the configure call.
      - If the resolver throws (network, auth, etc.) → fall back to the provider's `defaultValue` only, log a verbose warning, and continue. Do NOT crash configure.

      Update existing providers — codex, claude-code, kimi, opencode, goose — to keep their static arrays unchanged. No behavioral change for them.

      Tests in `src/cli/commands/configure-payload.test.ts`:
      - Static array path: unchanged behavior (regression).
      - Async resolver success path: choices reflect resolver output.
      - Async resolver throw path: configure proceeds with `defaultValue`.
      - Resolver only called once per configure run (cache check).

      Backwards-compat invariant: existing configure snapshots are byte-identical.
    status:
      implement: done
      test: done
      commit: done

  - id: add-gemini-cli-provider
    title: Add the gemini-cli provider file
    prompt: |
      Create `src/providers/gemini-cli.ts` using `createProvider`. Single declarative file — no if/branches anywhere else.

      Required pieces:

      1. Spread `geminiCliAgent` from `@poe-code/agent-defs`.
      2. `supportsStdinPrompt: true`, `supportsMcpSpawn: true`.
      3. `configurePrompts.model`:
         - `label: "Gemini model"`
         - `defaultValue: "gemini-2.5-pro"` (constant in `src/cli/constants.ts`)
         - `choices`: **async resolver** that calls `GET ${provider.baseUrl}/v1beta/models` with `Authorization: Bearer ${provider.credential}` (matches the gateway's `/google-ai-studio/v1beta/models` path — the provider's base URL already includes `/google-ai-studio`). Map response `models[].name` → `{ title, value }`. On failure, return a small static fallback `[gemini-2.5-pro, gemini-2.5-flash, gemini-3-pro, gemini-3-flash]`.
      4. `isolatedEnv`:
         - `agentBinary: "gemini"`
         - `configProbe: { kind: "isolatedFile", relativePath: "settings.json" }`
         - `env`:
           - `GEMINI_API_KEY: { kind: "providerCredential" }`
           - `GOOGLE_GEMINI_BASE_URL: { kind: "providerBaseUrl" }` (resolved per-shape after plan 04's `shape-scoped-baseurl` lands; until then provider-wide)
           - `HOME: { kind: "isolatedDir" }` so `~/.gemini/` lands inside the isolated tree
      5. `manifest.configure`: deep-merge `~/.gemini/settings.json` via `configMutation.merge` from `@poe-code/config-mutations` — NO regex, NO string templates. Write the JSON shape `{ selectedAuthType: "gemini-api-key", model: <selected>, mcpServers: {} }`. Use `fileMutation.ensureDirectory` for `~/.gemini` and `fileMutation.backup` for the settings file.
      6. `manifest.unconfigure`: remove only the keys this provider wrote. Idempotent.
      7. `install: GEMINI_CLI_INSTALL_DEFINITION` — npm global install of `@google/gemini-cli`, binary check for `gemini`.
      8. `test()`: invoke `gemini --version` via `createBinaryExistsCheck` plus a `createSpawnHealthCheck` that runs `gemini -p "say GEMINI_OK" --sandbox=false --output-format text --model <model>` and asserts the output contains `GEMINI_OK`.

      Export as `provider` per the auto-discovery convention in `src/providers/index.ts:41-59`.

      Tests in `src/providers/providers.test.ts`:
      - configure with mocked httpClient (returns 3 models) → `~/.gemini/settings.json` snapshot.
      - configure with httpClient that throws → falls back to static models, configure still succeeds.
      - unconfigure removes only this provider's keys; pre-existing user keys preserved.
      - All file I/O via memfs (CLAUDE.md mandate).
    status:
      implement: done
      test: done
      commit: done

  - id: gemini-cli-acp-spawn
    title: Wire ACP spawn for gemini-cli
    prompt: |
      Add a `spawn()` implementation on `geminiCliService` that drives `gemini --acp` over JSON-RPC stdio. Pattern parallels existing JSON-RPC-over-stdio spawn flows in the codex provider — reuse the shared transport in `@poe-code/agent-spawn` rather than reimplementing.

      Spawn args, in order:
      - `--acp`
      - `--sandbox=false` (required: sandbox does NOT propagate `GOOGLE_GEMINI_BASE_URL`, so requests would bypass the gateway)
      - `--model <selected-model>`
      - `--yolo` (auto-approve tool calls; matches how other providers are spawned by poe-code today)

      Env passed to the spawned process:
      - `GEMINI_API_KEY=<provider.credential>`
      - `GOOGLE_GEMINI_BASE_URL=<provider.baseUrl>`
      - `GEMINI_SYSTEM_MD=<path-to-rendered-system-prompt>` when poe-code injects one (matches how claude-code's system prompt path is wired today — write the file inside the isolated tree, point the env var at it).
      - Inherit anything declared by `isolatedEnv.env`.

      ACP method mapping (JSON-RPC 2.0):
      - `initialize` → on session start.
      - `authenticate` → no-op when env-key auth is used.
      - `newSession` → returns `sessionId`; remember it.
      - `prompt` → forward the user/system prompt; stream `session/update` notifications into the existing `AcpEvent` channel.
      - `cancel` → on abort signal.

      Surface `unstable_setSessionModel` so mid-session model switches work where the orchestrator supports them (no-op when not).

      Tests in `src/providers/gemini-cli.spawn.test.ts`:
      - Mock child process. Assert spawn args + env are exactly the values above for a representative model + provider.
      - JSON-RPC happy path: initialize → newSession → prompt → result.
      - Cancel path: abort signal triggers `cancel` then process kill.
      - Sandbox flag invariant: `--sandbox=false` always present, regression test.

      No CLI/SDK changes — this hooks into the existing spawn registry via `provider.spawn`.
    status:
      implement: done
      test: done
      commit: done

  - id: gemini-cli-skills
    title: Add SKILL templates for gemini-cli
    prompt: |
      Per CLAUDE.md, skills live as `SKILL_*.md` templates under `src/templates/<agent>/` and are distributed by `npm run sync-skills`. Create the gemini-cli template set:

      - `src/templates/gemini-cli/SKILL_poe-code-plan.md`
      - `src/templates/gemini-cli/SKILL_poe-code-pipeline-plan.md`
      - `src/templates/gemini-cli/SKILL_stop-slop.md`

      Mirror the content of the equivalent claude-code templates, adapted for Gemini's frontmatter conventions (Gemini CLI consumes the same markdown-with-frontmatter pattern via custom commands / extensions).

      Verify by running `npm run sync-skills` and confirming the synced files appear under `.claude/skills/gemini-cli/`. Add a unit test under `scripts/sync-skills.test.ts` (if one exists) that asserts every agent with an `agentDefinition` has either templates or an explicit empty-templates entry.

      Per CLAUDE.md feedback memory [dense prompts] and [explicit over implicit], skill bodies stay terse and declarative; do not restate CLAUDE.md inside them.
    status:
      implement: open
      test: open
      commit: open

  - id: manual-gemini-cli-terminal-pilot-direct
    title: Manually smoke test raw gemini-cli through the Poe gateway
    prompt: |
      Use terminal-pilot to run a direct gemini-cli smoke test against the Poe gateway.

      Preconditions:
      - `CF_AIG_TOKEN` is set in the environment.
      - Gateway base URL is provided via `CF_AIG_BASE_URL` or explicitly, for example `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/`.
      - Gemini CLI is installed and `gemini --version` succeeds.

      Run gemini-cli with:
      - `GEMINI_API_KEY=$CF_AIG_TOKEN`
      - `GOOGLE_GEMINI_BASE_URL` derived from the gateway base URL for the Google generations endpoint.
      - `--sandbox=false`
      - `--model gemini-2.5-pro`
      - `--output-format text`
      - prompt: `Reply with exactly: GEMINI_TERMINAL_PILOT_OK`

      Use terminal-pilot to inspect the terminal until the command exits. Pass only if stdout contains `GEMINI_TERMINAL_PILOT_OK` and the gateway URL is the only non-Google base URL used by the process. Record the exact command and result in the task notes. Do not print or persist the `CF_AIG_TOKEN` value.
    status:
      manual: open
      commit: open

  - id: manual-gemini-cli-terminal-pilot-configure
    title: Manually validate poe-code configure gemini-cli against the Poe gateway
    prompt: |
      Use terminal-pilot to validate the poe-code configure flow for gemini-cli with real credentials.

      Preconditions:
      - `CF_AIG_TOKEN` is set in the environment.
      - Gateway base URL is provided via `CF_AIG_BASE_URL` or explicitly, for example `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/`.
      - The cloudflare/provider entry exposes `google-generations` for gemini-cli.

      Run the configure command through `npm run dev -- configure gemini --provider cloudflare` using the gateway base URL and `CF_AIG_TOKEN` credential. Exercise the interactive path first so the dynamic Gemini model list is visible, then repeat the non-interactive `--yes` path. Repeat one configure invocation with the canonical `gemini-cli` name and verify it targets the same service and output file as the `gemini` alias.

      Use terminal-pilot to capture what prompts appeared and which model choices were offered. Pass only if configure succeeds, the selected model is written to `~/.gemini/settings.json`, `selectedAuthType` is `gemini-api-key`, and existing unrelated settings are preserved. Do not print or persist the `CF_AIG_TOKEN` value.
    status:
      manual: open
      commit: open

  - id: manual-gemini-cli-terminal-pilot-spawn-mcp
    title: Manually validate gemini-cli spawn and MCP through terminal-pilot
    prompt: |
      Use terminal-pilot to validate poe-code spawn with gemini-cli against the Poe gateway and with an MCP server.

      Preconditions:
      - `CF_AIG_TOKEN` is set in the environment.
      - Gateway base URL is provided via `CF_AIG_BASE_URL` or explicitly, for example `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/`.
      - gemini-cli has already been configured by poe-code.

      Run a spawn command through `npm run dev -- spawn --mcp-servers <json> gemini-cli <prompt>` where `<json>` defines a tiny stdio MCP server available in this repo, such as `tiny-stdio-mcp-test-server`. The prompt must require the MCP tool result and must also ask Gemini to include `GEMINI_MCP_OK` in the final response.

      Use terminal-pilot to inspect the terminal session until completion. Pass only if spawn exits successfully, `--sandbox=false` is present in the Gemini invocation path, the MCP tool result is used, and the final output contains `GEMINI_MCP_OK`. Record the exact command and result in the task notes. Do not print or persist the `CF_AIG_TOKEN` value.
    status:
      manual: open
      commit: open

  - id: gemini-cli-screenshot-validation
    title: Visual validation via screenshots
    prompt: |
      Per CLAUDE.md, every visual CLI change is validated via screenshots, not snapshot tests. Capture:

      - `npm run screenshot-poe-code -- configure gemini-cli --yes` — non-interactive configure path against a mocked provider.
      - `npm run screenshot-poe-code -- configure gemini-cli` — interactive path showing the dynamic model list.
      - `npm run screenshot-poe-code -- provider list` — confirms gemini-cli appears in the Agents column of any provider exposing `google-generations` (cloudflare per plan 04, plus any others added since).

      Inspect each screenshot for design coherence with the existing design system. No new screenshot snapshot tests are added (CLAUDE.md: screenshots are for adhoc validation only).

      If the design diverges from peer agents, fix the provider declaration (branding/colors/labels) — do not patch the design system per-agent.
    status:
      implement: open
      test: open
      commit: open
---

# Gemini CLI provider

Add Gemini CLI as a coding agent provider in poe-code, routed through the existing Cloudflare gateway via the `google-generations` API shape.

## 1. What we're building

A new declarative provider file at `src/providers/gemini-cli.ts` plus its companion agent definition at `packages/agent-defs/src/agents/gemini-cli.ts`. The canonical id is `gemini-cli`, with `gemini` as the user-facing alias for configure and spawn commands. Configure, install, test, and spawn lifecycles all derive from those two declarations — no provider-specific branches elsewhere.

The agent declares `apiShapes: ["google-generations"]` and is therefore compatible with any provider that exposes that shape. Plan 04's `add-cloudflare-provider` task establishes `cloudflareProvider` with the `google-generations` shape; Cloudflare requires a gateway base URL via `CF_AIG_BASE_URL` or `--base-url`, such as `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/`, and the provider appends the matching shape path. Once both plans land, `poe-code configure gemini --provider cloudflare --base-url <url> --yes` routes Gemini CLI through the Cloudflare gateway without touching gemini-cli code or hardcoding URLs anywhere; `gemini-cli` remains an equivalent canonical spelling.

Two new pieces of infrastructure are introduced:

1. **Async resolver for `configurePrompts.model.choices`** — needed because Gemini CLI's available model list is fetched from `GET <provider.baseUrl>/v1beta/models` at configure time, not hardcoded. The existing static-array shape continues to work; the resolver path is purely additive.
2. **ACP spawn handler** — Gemini CLI speaks Agent Client Protocol (JSON-RPC 2.0 over stdio) when invoked with `--acp`. The handler reuses the JSON-RPC transport already used by other providers (codex).

Explicit non-goals:

- A first-party `googleProvider` (direct `generativelanguage.googleapis.com`) is out of scope here. The Cloudflare gateway is the only target this plan integrates.
- No CLI flag changes on `poe-code configure` itself — Gemini CLI is selected as `gemini` (alias) or `gemini-cli` (canonical id) like existing aliased agents.
- No new permission system; Gemini CLI's `--yolo` flag is passed unconditionally during spawn (matches how other providers run inside poe-code today).
- No support for Gemini's interactive `gemini` REPL — spawn is non-interactive ACP only.

## 2. Dependencies on plan 04

This plan depends on plan 04 (`docs/plans/04-api-shape-providers.md`) being complete through at least the `add-cloudflare-provider` task. Specifically:

- `ApiShapeId` includes `"google-generations"`.
- `AgentDefinition.apiShapes` is wired through.
- `cloudflareProvider` is registered and exposes `google-generations`; callers provide the matching Cloudflare base URL explicitly.
- `ActiveProvider.baseUrl` resolves shape-scoped per `shape-scoped-baseurl`.

If plan 04 is not complete by the time this plan starts, the `add-gemini-cli-provider` task must block on it — the declared agent shape `["google-generations"]` will not match any registered provider without plan 04's cloudflare provider.

## 3. Authentication and base URL — no hardcoding

The provider file declares NO URLs. The cloudflare provider (from plan 04) declares the `google-generations` default. `ActiveProvider` resolution at configure/spawn time threads `provider.baseUrl` and `provider.credential` through `isolatedEnv.env`:

- `GOOGLE_GEMINI_BASE_URL` ← `provider.baseUrl` (kind: `providerBaseUrl`)
- `GEMINI_API_KEY` ← `provider.credential` (kind: `providerCredential`)

Gemini CLI's underlying `@google/genai` SDK reads `GOOGLE_GEMINI_BASE_URL` for the API endpoint and `GEMINI_API_KEY` for the bearer credential. The Cloudflare gateway validates the credential against `api.poe.com/v1/whoami`, strips the inbound `Authorization` header, and re-signs the request to Cloudflare AI Gateway — entirely transparent to gemini-cli.

The user-facing flow:

```sh
poe-code provider login cloudflare --api-key "$POE_API_KEY"
poe-code configure gemini --provider cloudflare --yes
poe-code spawn gemini "Refactor src/foo.ts to use async iterators"
```

With only `POE_API_KEY` set in the environment and no `cloudflare` login, the configure resolves nothing (cloudflare declares no env var) and prompts. This preserves plan 04's backwards-compat invariant.

## 4. Dynamic model list

`configurePrompts.model.choices` becomes lazy:

```ts
choices: async ({ httpClient, provider }) => {
  const res = await httpClient(`${provider.baseUrl}/v1beta/models`, {
    headers: { Authorization: `Bearer ${provider.credential}` }
  });
  const body = await res.json();
  return body.models
    .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
    .map(m => ({ title: m.displayName ?? m.name, value: stripModelsPrefix(m.name) }));
}
```

Cache the resolved array within a single configure run. On any failure, fall back to a small static array (`gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-pro`, `gemini-3-flash`) and emit a verbose warning. Configure must never fail solely because model discovery failed.

The static array also serves as the default offered when `--yes` is passed without `--model`.

## 5. ACP spawn details

Gemini CLI's ACP mode is enabled by `--acp` and speaks JSON-RPC 2.0 over stdio. The handler reuses the JSON-RPC transport already in `@poe-code/agent-spawn` (the same one codex uses).

Mandatory spawn args: `--acp --sandbox=false --model <m> --yolo`. The sandbox flag is non-negotiable because Gemini's sandbox does not forward `GOOGLE_GEMINI_BASE_URL` — requests would silently bypass the gateway and hit `generativelanguage.googleapis.com` directly with a Poe-issued key that the public API does not accept.

System prompt injection uses the `GEMINI_SYSTEM_MD` env var pointing at a rendered markdown file inside the isolated workspace tree — Gemini CLI's documented full-replacement override mechanism. The hierarchical `GEMINI.md` mechanism is not used by poe-code to avoid surprising the user's existing project files.

Session resume is not wired in this plan; `--resume` integration is a follow-up if needed.

## 6. Backwards-compatibility invariants

- `poe-code configure <existing-agent> --yes` snapshots remain byte-identical.
- The `dynamic-model-choices` task is purely additive — static-array providers (codex, claude-code, kimi, opencode, goose) are not migrated to the resolver form.
- The new agent does not appear in `provider list` Agents column for any provider that lacks `google-generations`. Plan 04's `provider list` rendering already derives the Agents column from shape intersection.
- All file I/O in tests goes through `memfs` per CLAUDE.md.
- No regex parsing of any config file; `~/.gemini/settings.json` is read and deep-merged through `configMutation.merge`.

## 7. Task dependency order

```
add-gemini-cli-agent-def
  → dynamic-model-choices
    → add-gemini-cli-provider
      → gemini-cli-acp-spawn
        → gemini-cli-skills
          → gemini-cli-screenshot-validation
```

The two gates are `dynamic-model-choices` (must land without breaking any existing provider's configure snapshot) and `add-gemini-cli-provider` (must produce a valid `~/.gemini/settings.json` whose mutations are idempotent).
