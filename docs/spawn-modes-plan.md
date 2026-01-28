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

// -s/--sandbox choices: read-only, workspace-write, danger-full-access
// Note: codex exec doesn't support -a/--ask-for-approval (interactive only)
const CODEX_MODE_CONFIG: Record<SpawnMode, { sandbox: string }> = {
  yolo: { sandbox: "danger-full-access" },
  edit: { sandbox: "workspace-write" },
  read: { sandbox: "read-only" }
};
```

## Claude Mode Configuration

```typescript
// --permission-mode choices: acceptEdits, bypassPermissions, default, delegate, dontAsk, plan
const CLAUDE_MODE_CONFIG: Record<SpawnMode, string[]> = {
  yolo: ["--dangerously-skip-permissions"],  // or: ["--permission-mode", "bypassPermissions"]
  edit: ["--permission-mode", "acceptEdits", "--allowed-tools", "Read,Write,Edit,Glob,Grep,NotebookEdit,Bash"],
  read: ["--permission-mode", "plan"]
};
```

## OpenCode Mode Configuration

OpenCode is native ACP and doesn't have explicit mode flags. It runs in full-access mode by default.

```typescript
const OPENCODE_MODE_CONFIG: Record<SpawnMode, string[]> = {
  yolo: [],  // Default behavior - full access
  edit: [],  // No granular mode support in CLI
  read: []   // No read-only mode in CLI
};
```

**CLI command** (non-interactive):
```bash
opencode run --format json --model provider/model "PROMPT"
```

## Kimi Mode Configuration

Kimi uses `--yolo` / `--yes` / `-y` flag for full access. Print mode (`--print`) implicitly enables yolo.

```typescript
const KIMI_MODE_CONFIG: Record<SpawnMode, string[]> = {
  yolo: [],  // --print implicitly enables --yolo
  edit: [],  // No granular mode support
  read: []   // No read-only mode
};
```

**CLI command** (non-interactive):
```bash
kimi --print --output-format stream-json -c "PROMPT"
# Or with stdin:
echo "PROMPT" | kimi --print --output-format stream-json --input-format text
```

Note: `--print` implicitly adds `--yolo`, so no need to specify it separately.

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
  const { sandbox } = CODEX_MODE_CONFIG[options.mode];
  return [
    "exec",
    "-m", options.model,
    "-s", sandbox,
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
3. ~~Should `edit` mode for Claude include `Bash` in allowedTools?~~ → Yes, included
