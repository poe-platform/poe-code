---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Cursor spawn-only agent

Add Cursor (`cursor-agent` CLI) as a spawn-only supported agent: agent definition, CLI spawn config, dedicated stream-json adapter, MCP config support, skills support, and model-notation conversion so `cursor:provider/model` works alongside Cursor-native model IDs.

## 1. What we're building

Spawn integration for Cursor's CLI agent. poe-code can spawn `cursor-agent` headlessly with a prompt, stream its events through the standard adapter pipeline, resume sessions, and report per-run token usage. The internal `provider/model` notation (e.g. `cursor:anthropic/claude-opus-4.7`) converts to Cursor-compatible IDs at spawn time; Cursor-native IDs (e.g. `claude-4.5-sonnet-thinking`, `composer-2.5-fast`) pass through unchanged. MCP servers are written to Cursor's MCP config file, and poe-code skills sync into Cursor's skill directories.

Non-goals:

- No configure integration. Cursor cannot be pointed at Poe's API (no base-URL override in the CLI); it runs on the user's own Cursor account/auth. `poe-code configure cursor` does nothing.
- No model catalog constant. Conversion is a transform, not a list (`agent models` is account/tier-scoped and text-only).
- No account-level usage limits. The CLI exposes none (`status --format json` / `about --format json` verified to contain auth/version only). Per-run usage from the `result` event is in scope; account quotas would require Cursor's Admin API (team admin key) and are out of scope.
- No env-var or inline-flag MCP injection. Verified: the CLI has no inline MCP flags, and `CURSOR_CONFIG_DIR` does not redirect `mcp.json` lookup. MCP-at-spawn works through the workspace config file instead (see level 3).

## 2. User-facing shape

```bash
# Spawn with internal notation — converted to Cursor IDs automatically
poe-code spawn cursor --model anthropic/claude-opus-4.7 "Fix the failing test"

# Cursor-native IDs work verbatim
poe-code spawn cursor --model claude-4.5-sonnet-thinking "Explain this module"
poe-code spawn cursor --model composer-2.5-fast "Rename foo to bar"

# Agent:model specifier (existing syntax, no parser changes)
poe-code harness run --agent cursor:openai/gpt-5.5 plan.md

# Resume a prior session (threadId = Cursor session_id)
poe-code spawn cursor --resume-thread-id 6546af96-c2bf-4bdb-ae2b-830084db7efa "Continue"

# Stdin prompt
echo "Summarize the diff" | poe-code spawn cursor

# Modes
poe-code spawn cursor --mode yolo "..."   # --force --sandbox disabled
poe-code spawn cursor --mode edit "..."   # --force (edits allowed, denials respected)
poe-code spawn cursor --mode read "..."   # --mode plan (read-only)

# Health check
poe-code test --agent cursor

# Install
poe-code install cursor

# MCP at spawn — servers injected for this run only
poe-code spawn cursor --mcp-servers '{"playwright":{"command":"npx","args":["@playwright/mcp"]}}' "Test the login page"
poe-code spawn cursor --mcp-servers @servers.json "..."

# MCP: write servers into ~/.cursor/mcp.json (standard shape)
poe-code mcp configure cursor

# Skills: sync-skills picks cursor up automatically
npm run sync-skills   # writes ~/.cursor/skills-cursor/<name>/SKILL.md and .cursor/skills/<name>/SKILL.md
```

Output streams through the standard renderer: reasoning, agent messages, tool start/complete, and a usage line (input/output/cached tokens) from Cursor's `result` event.

SDK parity: `spawnCli({ agent: "cursor", model, mode, resumeThreadId, useStdin })` works identically — the CLI command already routes through the same `agent-spawn` package.

## 3. Implementation details and technical decisions

### Identity

- id `cursor`, alias `cursor-agent`, label `Cursor`, binaryName `cursor-agent` (install creates both `agent` and `cursor-agent` symlinks; `cursor-agent` is collision-safe).
- configPath `~/.cursor/cli-config.json`.
- No `apiShapes` — Cursor speaks only its own backend. This is the first spawn-only agent; `agent-defs.test.ts` only asserts `apiShapes` for provider-backed agents, so omission is valid.
- branding: dark `#FFFFFF`, light `#000000` (Cursor's monochrome mark).

### Model conversion (verified against cursor-agent 2026.06.04)

`stripModelNamespace` removes `provider/` and lowercases. Cursor's catalog is family-inconsistent: Anthropic IDs use dashes in version numbers, OpenAI/Google use dots, and Cursor-native Anthropic IDs put the version *before* the family with dots (`claude-4.5-sonnet`). Verified acceptance matrix:

| Input to `--model` | Result |
| --- | --- |
| `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` | accepted |
| `claude-opus-4.8` (dots) | rejected |
| `gpt-5.5`, `gpt-5.3-codex`, `gemini-3.1-pro` (dots) | accepted |
| `gpt-5-5`, `gemini-3-1-pro` (dashes) | rejected |
| `claude-4.5-sonnet`, `composer-2.5-fast` (native, verbatim) | accepted |
| `claude-4-5-sonnet` (native, dashed) | rejected |
| anything unknown | rejected with full catalog in stderr |

Transform: dots→dashes only for poe-style Claude IDs, where the family name immediately follows `claude-`. Plain `startsWith` checks, no regex:

```ts
modelStripProviderPrefix: true,
modelTransform: (model) =>
  model.startsWith("claude-opus-") ||
  model.startsWith("claude-sonnet-") ||
  model.startsWith("claude-haiku-")
    ? model.replaceAll(".", "-")
    : model,
```

This converts every poe Claude ID, leaves poe GPT/Gemini IDs intact, and passes every Cursor-native ID through untouched (native Claude IDs are `claude-<version>-<family>`, so the prefixes never match; dashed natives like `claude-opus-4-8-high` are no-ops under `replaceAll`).

`DEFAULT_CURSOR_MODEL = DEFAULT_FRONTIER_MODEL` (`anthropic/claude-opus-4.7` → `claude-opus-4-7`, verified accepted) — same pattern as goose.

### Spawn config (verified)

- Headless: `--output-format stream-json --trust --approve-mcps` as `defaultArgs` (beforePrompt). `--trust` is required — without it headless runs block on a "Workspace Trust Required" prompt. `--approve-mcps` makes configured MCP servers load without interactive approval (only effective with `--print`, which is always our headless path).
- `promptFlag: "-p"` (the `--print` flag), prompt is positional right after it — `cursor-agent ... -p "<prompt>"`. Stdin works with `-p` and no prompt arg (`stdinMode: { omitPrompt: true, extraArgs: [] }`).
- Modes: yolo `["--force", "--sandbox", "disabled"]`; edit `["--force"]`; read `["--mode", "plan"]`.
- Resume: `ResumeSpec` with `args: (threadId) => ["--resume", threadId]`, `position: "beforePrompt"`; hint composes `cursor-agent --resume <id>`.
- Interactive: `defaultArgs: []` (bare `cursor-agent` opens the TUI; `--force` optional via mode).
### MCP at spawn (workspace config file)

Verified mechanism: Cursor merges workspace `.cursor/mcp.json` with the global config (`agent mcp list` from a directory containing one shows its servers), and `--approve-mcps` loads them headless without prompts. There is no inline flag and `CURSOR_CONFIG_DIR` does not affect `mcp.json` lookup (verified both).

Cursor can't use `mcpArgs` (args) or `mcpEnv` (env) — it needs a file. Extend `CliSpawnConfig` with a third, equally declarative MCP hook:

```ts
// packages/agent-spawn/src/types.ts
export interface McpFileSpec {
  /** File path relative to the spawn cwd, e.g. ".cursor/mcp.json" */
  relativePath: string;
  /** JSON value deep-merged into the existing file content */
  content: (servers: McpSpawnConfig) => Record<string, unknown>;
}

// CliSpawnConfig gains:
mcpFile?: McpFileSpec;
```

Spawn lifecycle in `spawn.ts`: when `options.mcpServers` and `config.mcpFile` are set, before launching the child — read the existing file if present (JSON parse, never regex), deep-merge `content(servers)`, write. After the child exits, restore the prior content (or remove the file if it didn't exist) in a `finally`, so the user's workspace config is never permanently mutated. Merge/restore logic lives in a pure module (`packages/agent-spawn/src/configs/mcp-file.ts`) so tests run on strings/memfs.

`supportsMcpAtSpawn()` in `configs/index.ts` extends its check to `mcpFile`.

Cursor's entry:

```ts
mcpFile: {
  relativePath: ".cursor/mcp.json",
  content: (servers) => ({ mcpServers: toJsonMcpServers(servers) })
}
```

(`toJsonMcpServers` already exists in `configs/mcp.ts`; export it.) Sequential spawns are the working assumption, so a single merge/restore pair per run is safe.

### MCP config

Entry in `agentMcpConfigs` (`packages/agent-mcp-config/src/configs.ts`):

```ts
cursor: {
  configFile: "~/.cursor/mcp.json",
  configKey: "mcpServers",
  format: "json",
  shape: "standard"
}
```

Verified: `~/.cursor/mcp.json` with `mcpServers` key is Cursor's documented and observed global MCP config; standard `{command, args, env}` shape.

### Skills

Cursor reads `<skill-name>/SKILL.md` with `name`/`description` frontmatter — identical to the format sync-skills writes (verified against installed skills on disk). Entry in `agentSkillConfigs` (`packages/agent-skill-config/src/configs.ts`):

```ts
cursor: {
  globalSkillDir: "~/.cursor/skills-cursor",
  localSkillDir: ".cursor/skills"
}
```

`scripts/sync-skills.ts` gets `cursor: []` in `agentTemplateSets` (no cursor-specific template overrides; the shared set applies).

### Adapter (`cursor`)

Cursor's stream-json is NDJSON with top-level typed events (captured live). None of the existing adapters fit: `claude` drops Cursor's top-level `tool_call` events and reads snake_case usage; `native` expects an `event` key. Mapping:

| Cursor event | AcpEvent |
| --- | --- |
| `system`/`init` | `session_start` (threadId = `session_id`) |
| `thinking` `delta` | `reasoning` |
| `assistant` (content text join) | `agent_message` |
| `tool_call` `started` | `tool_start` (kind from tool key, e.g. `editToolCall` → `edit`; title from args.path or tool name; id = `call_id`) |
| `tool_call` `completed` | `tool_complete` (kind, path, id) |
| `result` | `usage` (inputTokens, outputTokens, cachedTokens = cacheReadTokens) then `spawn_result` (exitCode, threadId, usage) |
| `result` with `is_error: true` | `error` then `spawn_result` |
| unknown types | passthrough as `UnknownAcpEvent` |

Tool-call kind mapping is a lookup on the single key inside `tool_call`: `editToolCall` → `edit`, `readToolCall` → `read`, `shellToolCall`/`bashToolCall` → `exec`, anything else → `other`.

### Per-run usage

Cursor's `result` event carries `usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` (camelCase). The adapter surfaces it through the existing `UsageEvent`/`SpawnResultEvent` so dashboards and harness accounting work with no new plumbing. `cacheWriteTokens` goes into `_meta`.

### Provider file (minimal, spawn-only)

`src/providers/cursor.ts` exports a `createProvider` result with `requiresProvider: false` (no Poe credential needed — configure.ts already honors this), `manifest.configure: []` (nothing to write), an install definition (`curl https://cursor.com/install -fsS | bash` on darwin/linux), and a `test` using `createSpawnHealthCheck("cursor", ...)` so `poe-code test --agent cursor` exercises real spawn per the test-command rule.

### Env

No env vars injected. Cursor auth is its own login/`CURSOR_API_KEY`; poe-code does not manage it. README of `agent-spawn` documents that Cursor spawns against the user's Cursor account.

## 4. Interfaces and test plan

### New/changed signatures

```ts
// packages/agent-defs/src/agents/cursor.ts
export const cursorAgent: AgentDefinition; // id "cursor", aliases ["cursor-agent"], no apiShapes

// packages/agent-spawn/src/adapters/cursor.ts
export async function* adaptCursor(lines: AsyncIterable<string>): AsyncGenerator<AdapterOutput>;

// packages/agent-spawn/src/adapters/index.ts
export type AdapterType = "codex" | "claude" | "kimi" | "native" | "opencode" | "cursor";

// packages/agent-spawn/src/configs/cursor.ts
export const cursorSpawnConfig: CliSpawnConfig; // kind "cli", agentId "cursor", adapter "cursor", mcpFile

// packages/agent-spawn/src/configs/mcp-file.ts
export function mergeMcpFileContent(existing: string | undefined, addition: Record<string, unknown>): string;
export function applyMcpFile(spec: McpFileSpec, servers: McpSpawnConfig, cwd: string): Promise<() => Promise<void>>; // returns restore fn

// src/cli/constants.ts
export const DEFAULT_CURSOR_MODEL = DEFAULT_FRONTIER_MODEL;

// src/providers/cursor.ts
export const provider: ProviderService; // requiresProvider: false, manifest.configure: []
```

### Tests

- `packages/agent-spawn/src/adapters/adapters.test.ts` — feed the captured real transcript (init, thinking deltas, assistant, tool_call started/completed with `editToolCall`, result with usage) as a fixture; assert the exact AcpEvent sequence, threadId propagation, camelCase usage mapping, `is_error` → `error` event, unknown-type passthrough. Fixture lines are committed verbatim from the live capture (cursor-agent 2026.06.04).
- `packages/agent-spawn/src/configs/configs.test.ts` — arg assembly per mode (`--trust` always present headless; yolo/edit/read args), model transform table (all 7 verified rows above as cases), stdin omits prompt, resume args injected beforePrompt, `supportsMcpAtSpawn("cursor") === true`.
- `packages/agent-spawn/src/configs/mcp-file.test.ts` — merge into missing/empty/populated existing file (deep merge preserves unrelated keys and existing `mcpServers` entries), restore puts back prior content, restore removes file that didn't exist, malformed existing JSON surfaces a clear error. memfs only.
- `packages/agent-defs/src/agent-defs.test.ts` — add `cursorAgent` to `expectedAgents`; `resolveAgentId("cursor-agent") === "cursor"`. Do not add to `expectedProviderAgentApiShapes`.
- `src/providers/providers.test.ts` — provider auto-discovered, `requiresProvider === false`, configure is a no-op (memfs: no files written).
- `packages/agent-mcp-config/src/agent-mcp-config.test.ts` — cursor resolves as supported; config path/key/format/shape; alias `cursor-agent` resolves.
- `packages/agent-skill-config/src/agent-skill-config.test.ts` — cursor resolves as supported; global/local dirs; `resolveSkillDir` expansion.
- `scripts/sync-skills.test.ts` — cursor present in `agentTemplateSets` (existing test asserts coverage of all supported agents).
- All tests are pure/in-memory (no child processes, no network, memfs only) — fast per the testing rules.

### Manual QA (markdown steps, not a script)

1. `npm run dev -- test --agent cursor` → CURSOR_OK-style health check passes.
2. `npm run dev -- spawn cursor --model anthropic/claude-opus-4.7 "Reply OK"` → streams reasoning/message, prints usage.
3. Same with `--model claude-4.5-sonnet-thinking` (native ID).
4. Resume: run once, copy threadId from output, `--resume-thread-id <id> "continue"`.
5. `npm run screenshot-poe-code -- spawn cursor "Reply OK"` to verify rendering.
6. MCP at spawn: `npm run dev -- spawn cursor --mcp-servers '{"dummy":{"command":"echo"}}' "List your MCP servers"` → agent sees `dummy`; afterwards `.cursor/mcp.json` in the cwd is back to its pre-run state.
7. `npm run dev -- mcp configure cursor` → entry appears in `~/.cursor/mcp.json` under `mcpServers`; `cursor-agent mcp list` shows it.
8. `npm run sync-skills` → skills appear in `~/.cursor/skills-cursor/`; spawn cursor and confirm a poe-code skill is invokable.

### Autonomy checklist

- Captured transcript fixture is in the repo before adapter work starts (it is the source of truth; no live calls in tests).
- `cursor-agent` binary is installed and authed on the dev machine for QA steps only.
- The verified model matrix in level 3 is the contract — if Cursor changes acceptance rules, update the transform and the matrix together.

## 5. Code plan

### Files to create

| File | Purpose |
| --- | --- |
| `packages/agent-defs/src/agents/cursor.ts` | Agent definition |
| `packages/agent-spawn/src/adapters/cursor.ts` | stream-json → AcpEvent adapter |
| `packages/agent-spawn/src/adapters/fixtures/cursor-transcript.ndjson` | Captured real transcript fixture (location per existing fixture conventions in adapters tests) |
| `packages/agent-spawn/src/configs/cursor.ts` | CliSpawnConfig with model transform + `mcpFile` |
| `packages/agent-spawn/src/configs/mcp-file.ts` | Workspace MCP file merge/restore (pure, fs-injected) |
| `src/providers/cursor.ts` | Minimal spawn-only provider (install + test, empty configure) |

### Files to change

| File | Change |
| --- | --- |
| `packages/agent-defs/src/agents/index.ts` | export `cursorAgent` |
| `packages/agent-defs/src/registry.ts` | add to `allAgents` |
| `packages/agent-defs/src/index.ts` | re-export |
| `packages/agent-spawn/src/adapters/index.ts` | add `cursor` to `AdapterType`, adapter map, export |
| `packages/agent-spawn/src/types.ts` | add `McpFileSpec` + `mcpFile?` on `CliSpawnConfig` |
| `packages/agent-spawn/src/spawn.ts` | apply/restore `mcpFile` around child lifecycle |
| `packages/agent-spawn/src/configs/mcp.ts` | export `toJsonMcpServers` |
| `packages/agent-spawn/src/configs/index.ts` | add `cursorSpawnConfig` to `allSpawnConfigs`; `supportsMcpAtSpawn` covers `mcpFile` |
| `packages/agent-mcp-config/src/configs.ts` | add `cursor` to `agentMcpConfigs` |
| `packages/agent-skill-config/src/configs.ts` | add `cursor` to `agentSkillConfigs` |
| `scripts/sync-skills.ts` | add `cursor: []` to `agentTemplateSets` |
| `src/cli/constants.ts` | add `DEFAULT_CURSOR_MODEL` |
| `packages/agent-defs/src/agent-defs.test.ts` | expectedAgents + alias resolution |
| `packages/agent-spawn/src/adapters/adapters.test.ts` | cursor adapter cases |
| `packages/agent-spawn/src/configs/configs.test.ts` | cursor config cases |
| `src/providers/providers.test.ts` | cursor provider cases |
| `packages/agent-mcp-config/src/agent-mcp-config.test.ts` | cursor MCP config cases |
| `packages/agent-skill-config/src/agent-skill-config.test.ts` | cursor skill config cases |
| `packages/agent-spawn/README.md` | document cursor agent: auth model (own Cursor account), env vars (none), modes |
| `docs/research/mcp-agents.md` | move cursor from unsupported to supported |

### Build order (branch stays green at every step)

1. Commit the transcript fixture.
2. Agent def + barrel/registry/index wiring + `agent-defs.test.ts` (TDD: test first).
3. Adapter test (fixture-driven) → `adaptCursor` → `AdapterType` wiring.
4. `mcp-file.test.ts` → `mcp-file.ts` → `McpFileSpec` type + `spawn.ts` apply/restore wiring (core extension lands green before any cursor consumer).
5. Spawn config test (modes/transform/stdin/resume/mcpFile) → `cursorSpawnConfig` → configs index + `supportsMcpAtSpawn`.
6. `DEFAULT_CURSOR_MODEL` constant.
7. Provider test → `src/providers/cursor.ts`.
8. MCP config test → `agentMcpConfigs` entry.
9. Skill config test → `agentSkillConfigs` entry; `agentTemplateSets` + `npm run sync-skills`.
10. README + `docs/research/mcp-agents.md`; run manual QA steps; `npm run dev -- test --agent cursor`.
