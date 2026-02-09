# Spawn Modes: Permission Levels for poe-code

## Context

Currently, each provider hardcodes its permission/sandbox arguments:
- **Claude Code**: hardcoded to `--permission-mode acceptEdits --allowedTools Bash,Read` (roughly "edit" level)
- **Codex**: hardcoded to `--full-auto` (roughly "yolo" level)
- **OpenCode**: granular permission system (`allow`/`ask`/`deny` per tool) configured via JSON — no single CLI flag
- **Kimi**: `--yolo` flag for auto-approve; without it, agent prompts before actions

The goal is to expose three simple, unified permission levels — `yolo`, `edit`, `read` — as a `--mode` flag on the spawn command, matching the pattern from the Python agent scripts. The mode name is universal; each provider maps it to its own CLI arguments declaratively.

## Modes

| Mode | Intent | Use case |
|------|--------|----------|
| `yolo` | Full access, no approval prompts | Trusted automation, CI/CD, headless |
| `edit` | Can read + write files, but agent asks before destructive shell ops | Development, controlled coding tasks |
| `read` | Read-only, no file writes or shell commands | Code review, exploration, Q&A |

Default: **`yolo`** (matches current scripting behavior and most-permissive posture).

## Per-Provider Mapping

### Claude Code

```typescript
// --permission-mode choices: acceptEdits, bypassPermissions, default, delegate, dontAsk, plan
const CLAUDE_MODE_CONFIG: Record<SpawnMode, string[]> = {
  yolo: ["--dangerously-skip-permissions"],
  edit: ["--permission-mode", "acceptEdits", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep,NotebookEdit"],
  read: ["--permission-mode", "plan"],
};
```

### Codex

```typescript
// -s/--sandbox choices: read-only, workspace-write, danger-full-access
// Note: codex exec doesn't support -a/--ask-for-approval (interactive only)
const CODEX_MODE_CONFIG: Record<SpawnMode, { sandbox: string }> = {
  yolo: { sandbox: "danger-full-access" },
  edit: { sandbox: "workspace-write" },
  read: { sandbox: "read-only" },
};
```

### Kimi

Kimi uses `--yolo` / `--yes` / `-y` to auto-approve all actions. Without it, the agent prompts the user before executing shell commands or file edits — effectively an "edit" mode. There is no read-only/plan mode.

```typescript
const KIMI_MODE_CONFIG: Record<SpawnMode, string[]> = {
  yolo: ["--yolo"],
  edit: [],       // Default Kimi behavior — prompts before actions
  read: [],       // Not supported, falls back to edit
};
```

Note: In non-interactive/print mode (`--print`), `--yolo` is implied. The mode mapping only applies to interactive spawns.

### OpenCode

OpenCode has a granular permission system (`allow` / `ask` / `deny` per tool with glob pattern matching). Permissions are configured via a project-level `opencode.json` file which takes priority over global config. The `permission` key uses nested `{ tool: { pattern: action } }` syntax where `"*"` matches all tools/patterns.

Mode is applied by writing a project-level `opencode.json` in the working directory before spawning. This overrides all other permission configs.

```typescript
// OpenCode modes are applied by writing a project-level opencode.json in the cwd before spawn.
// Project config takes priority over global config, so this overrides everything.
const OPENCODE_MODE_CONFIG: Record<SpawnMode, { agent?: string; permission: Record<string, Record<string, string>> }> = {
  yolo: { permission: { "*": { "*": "allow" } } },
  edit: { permission: { "*": { "*": "allow" }, "bash": { "*": "ask" }, "external_directory": { "*": "ask" } } },
  read: { agent: "plan", permission: { "*": { "*": "ask" }, "edit": { "*": "deny" }, "bash": { "*": "deny" } } },
};
```

The `read` mode can alternatively use the built-in `plan` agent via `--agent plan` (denies edits, asks for bash).

## User Experience

### CLI — spawn command

```bash
# Default (yolo) — full access, no prompts
poe-code spawn claude-code "fix the auth bug"

# Explicit mode
poe-code spawn claude-code --mode edit "refactor the logger"
poe-code spawn codex --mode read "explain the payment flow"

# Works with all existing flags
poe-code spawn codex --mode edit --model gpt-5.2 -C ./my-project "add tests"
```

`--mode` appears in help alongside existing options:
```
Options:
  --model <model>   Model identifier override
  --mode <mode>     Permission mode: yolo | edit | read (default: yolo)
  -C, --cwd <path>  Working directory
  --stdin           Read the prompt from stdin
  -i, --interactive Launch the agent in interactive TUI mode
```

No interactive prompt for mode — it's always explicit via `--mode` or defaults to `yolo`. This keeps the spawn command fast and scriptable.

### SDK

```typescript
import { spawn } from "poe-code";

// Default (yolo)
const { events, result } = spawn("claude-code", "fix the bug");

// Explicit mode
const { events, result } = spawn("claude-code", {
  prompt: "refactor the logger",
  mode: "edit",
});

// Read-only exploration
const { result } = spawn("codex", {
  prompt: "explain auth flow",
  mode: "read",
});
```

### Behavioral change

Claude Code's default changes from `edit`-like → `yolo`. Users who relied on the implicit `acceptEdits` behavior should pass `--mode edit` explicitly. This is intentional — the default should be the most permissive mode for script/automation contexts.

## Implementation Approach

### Provider declaration pattern

Each provider declares a `modes` record mapping mode names to CLI args. This is pure data — no if/case branching by provider:

```typescript
// In provider's spawn config
modes: {
  yolo: ["--dangerously-skip-permissions"],
  edit: ["--permission-mode", "acceptEdits", "--allowedTools", "..."],
  read: ["--permission-mode", "plan"],
}
```

The framework resolves `mode → args` and appends them.

**Invariant**: Every provider must declare all three modes (`yolo`, `edit`, `read`). Providers that don't natively support a mode use empty arrays — the type system enforces completeness via `Record<SpawnMode, string[]>`. This means no runtime "unsupported mode" errors and no if/case branching by provider name.

### Flow

```
CLI --mode flag
    ↓
SpawnCommandOptions.mode
    ↓
SDK SpawnOptions.mode
    ↓
agent-spawn resolves: config.modes[mode] → args[]
    ↓
Appended to agent CLI invocation
```

### Files to modify

**Types** (add `SpawnMode`, extend interfaces):
- `packages/agent-spawn/src/types.ts` — `SpawnMode` type, `modes`/`defaultMode` on `CliSpawnConfig`, `mode` on `SpawnOptions`
- `src/sdk/types.ts` — `mode` on SDK `SpawnOptions`
- `src/providers/spawn-options.ts` — `mode` on `SpawnCommandOptions`

**Spawn configs** (split hardcoded defaults, add mode maps):
- `packages/agent-spawn/src/configs/claude-code.ts`
- `packages/agent-spawn/src/configs/codex.ts`
- `packages/agent-spawn/src/configs/opencode.ts`
- `packages/agent-spawn/src/configs/kimi.ts`

**Arg building** (resolve mode, append mode args):
- `packages/agent-spawn/src/spawn.ts`
- `packages/agent-spawn/src/acp/spawn.ts`
- `packages/agent-spawn/src/spawn-interactive.ts`

**Provider spawn methods** (consume mode from options):
- `src/providers/claude-code.ts` — update `buildClaudeArgs`
- `src/providers/codex.ts` — update `buildCodexExecArgs`

**CLI** (add --mode flag, thread through):
- `src/cli/commands/spawn.ts`

**SDK** (forward mode):
- `src/sdk/spawn.ts`
- `src/sdk/spawn-core.ts`

### Ralph integration

Ralph (the orchestrator) must always spawn agents in `yolo` mode. Ralph manages multi-step plans where each agent task runs headless — prompting for approval mid-plan would block the entire pipeline. Ralph hardcodes `mode: "yolo"` when calling spawn, regardless of what the user's default might be.

### Verification

1. `npm run test` — unit tests for mode arg resolution per provider
2. `npm run e2e:verbose` — e2e tests (spawn is affected)
3. `npm run screenshot-poe-code -- spawn --help` — verify help output includes --mode
4. `npm run dev -- spawn claude-code --mode read "explain this code" --dry-run` — verify correct args in dry-run
5. `npm run lint` — ensure no lint issues
