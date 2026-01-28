# Spawn Modes Plan

## Goal

Support different execution modes for spawned agents, controlling sandbox restrictions and approval requirements.

## Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `yolo` | Full access, no approvals | Trusted automation, CI/CD |
| `edit` | Workspace write only | Development, controlled changes |
| `read` | Read-only access | Code review, exploration |

## Codex Mode Configuration

```typescript
export type SpawnMode = "yolo" | "edit" | "read";

const CODEX_MODE_CONFIG: Record<SpawnMode, { sandbox: string; approval: string }> = {
  yolo: { sandbox: "danger-full-access", approval: "never" },
  edit: { sandbox: "workspace-write", approval: "never" },
  read: { sandbox: "read-only", approval: "never" }
};
```

## Claude Mode Configuration

```typescript
const CLAUDE_MODE_CONFIG: Record<SpawnMode, string[]> = {
  yolo: ["--dangerously-skip-permissions"],
  edit: ["--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep,NotebookEdit,Bash"],
  read: ["--permission-mode", "plan"]
};
```

## OpenCode Mode Configuration

OpenCode uses granular permissions in `opencode.json`. For CLI, use `OPENCODE_PERMISSION` env var or `--config` flag.

```typescript
const OPENCODE_MODE_CONFIG: Record<SpawnMode, Record<string, string>> = {
  yolo: { "*": "allow" },
  edit: { "*": "deny", "read": "allow", "edit": "allow", "glob": "allow", "grep": "allow", "bash": "allow" },
  read: { "*": "deny", "read": "allow", "glob": "allow", "grep": "allow" }
};
```

**CLI command**:
```bash
opencode run --format json --model MODEL "PROMPT"
# With inline permissions:
OPENCODE_PERMISSION='{"*":"allow"}' opencode run --format json "PROMPT"
```

## Kimi Mode Configuration

Kimi uses `--yolo` flag for full access. Print mode (`--print`) implicitly enables yolo.

```typescript
const KIMI_MODE_CONFIG: Record<SpawnMode, string[]> = {
  yolo: ["--yolo"],
  edit: [],  // Default behavior with prompts
  read: []   // No explicit read-only mode, relies on agent behavior
};
```

**CLI command** (non-interactive):
```bash
kimi --print --output-format stream-json --yolo "PROMPT"
# Or with stdin:
echo "PROMPT" | kimi --print --output-format stream-json --yolo
```

## CLI Integration

```bash
# Default mode (yolo)
poe-code spawn codex "fix the bug"

# Explicit mode
poe-code spawn codex --mode edit "refactor this function"
poe-code spawn codex --mode read "explain this code"
```

## Provider Configuration

Providers declare supported modes:

```typescript
// codex.ts
{
  name: "codex",
  spawnConfig: {
    modes: ["yolo", "edit", "read"],
    defaultMode: "yolo"
  }
}
```

## Argument Building

### Codex

```typescript
function buildCodexArgs(options: { model: string; mode: SpawnMode; cwd: string }): string[] {
  const config = CODEX_MODE_CONFIG[options.mode];
  return [
    "exec",
    "-m", options.model,
    "-s", config.sandbox,
    "-C", options.cwd,
    "--skip-git-repo-check",
    "--color", "never",
    "--json",
    "-"  // read prompt from stdin
  ];
}
```

### Claude

```typescript
function buildClaudeArgs(options: { model: string; mode: SpawnMode; prompt: string }): string[] {
  const modeArgs = CLAUDE_MODE_CONFIG[options.mode];
  return [
    "--model", options.model,
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    ...modeArgs,
    options.prompt  // prompt as positional arg (not stdin)
  ];
}
```

## Implementation Steps

1. Add `SpawnMode` type to `src/acp/types.ts`
2. Add `--mode` flag to spawn command
3. Update Codex adapter to use mode config
4. Add mode validation per provider

## Open Questions

1. ~~Should modes be agent-specific or unified across all agents?~~ → Unified mode names, agent-specific args
2. ~~How do modes map for Claude Code?~~ → Documented above
3. Should `edit` mode for Claude include `Bash` in allowedTools?
