# Spawn Interactive Mode Plan

## Goal

Add `--interactive` / `-i` flag to `poe-code spawn` that launches agents in their native interactive TUI mode instead of non-interactive JSON streaming mode.

## Use Cases

| Mode | Use Case |
|------|----------|
| Non-interactive (default) | CI/CD, automation, scripting, programmatic control |
| Interactive | Human-in-the-loop development, exploratory coding, debugging |

## Provider Commands

### Claude

```typescript
function buildClaudeArgs(options: { model: string; mode: SpawnMode; prompt: string; interactive: boolean }): string[] {
  const modeArgs = CLAUDE_MODE_CONFIG[options.mode];

  if (options.interactive) {
    // Interactive: no -p, no --output-format, no --verbose
    return [
      "--model", options.model,
      ...modeArgs,
      options.prompt
    ];
  }

  // Non-interactive
  return [
    "--model", options.model,
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    ...modeArgs,
    options.prompt
  ];
}
```

| Flag | Interactive | Non-interactive |
|------|-------------|-----------------|
| `-p` | No | Yes |
| `--output-format` | None | `stream-json` |
| `--verbose` | No | Yes |

### Codex

```typescript
function buildCodexArgs(options: { model: string; mode: SpawnMode; cwd: string; interactive: boolean }): string[] {
  const config = CODEX_MODE_CONFIG[options.mode];

  if (options.interactive) {
    // Interactive: use `codex` directly, not `codex exec`
    return [
      "-m", options.model,
      "-s", config.sandbox,
      "-a", config.approval,
      "-C", options.cwd,
      // prompt is passed as final positional arg
    ];
  }

  // Non-interactive: use `codex exec`
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

| Aspect | Interactive | Non-interactive |
|--------|-------------|-----------------|
| Command | `codex` | `codex exec` |
| Approval | `-a never` | N/A |
| JSON output | No | `--json` |
| Prompt input | Positional arg | stdin (`-`) |

### OpenCode

```typescript
function buildOpenCodeArgs(options: { model: string; mode: SpawnMode; interactive: boolean }): string[] {
  if (options.interactive) {
    // Interactive: standard run without --format
    return [
      "run",
      "--model", options.model
      // Opens TUI, prompt entered interactively
    ];
  }

  // Non-interactive
  return [
    "run",
    "--format", "json",
    "--model", options.model
  ];
}
```

| Flag | Interactive | Non-interactive |
|------|-------------|-----------------|
| `--format` | None (TUI) | `json` |

### Kimi

```typescript
function buildKimiArgs(options: { mode: SpawnMode; interactive: boolean }): string[] {
  const modeArgs = KIMI_MODE_CONFIG[options.mode];

  if (options.interactive) {
    // Interactive: no --print, launches TUI shell
    return [...modeArgs];
  }

  // Non-interactive: --print mode
  return [
    "--print",
    "--output-format", "stream-json",
    ...modeArgs
  ];
}
```

| Flag | Interactive | Non-interactive |
|------|-------------|-----------------|
| `--print` | No | Yes |
| `--output-format` | None | `stream-json` |
| UI Mode | Shell TUI | Print mode |

## CLI Integration

```bash
# Non-interactive (default) - for automation
poe-code spawn claude "fix the bug"
poe-code spawn codex "add tests"

# Interactive - for human-in-the-loop
poe-code spawn claude --interactive "help me debug this"
poe-code spawn codex -i "let's refactor together"

# Shorthand
poe-code spawn -i claude "explore the codebase"
```

## SDK Integration

```typescript
import { spawn } from "poe-code";

// Non-interactive (default)
const result = await spawn("claude", {
  prompt: "fix the bug",
  mode: "yolo"
});

// Interactive - spawns TUI, returns when user exits
const result = await spawn("claude", {
  prompt: "help me debug",
  interactive: true
});
```

## Implementation

### Return Types

```typescript
interface SpawnResult {
  success: boolean;
  output: string | null;       // null in interactive mode
  exitCode: number;
  usage: Usage | null;         // null in interactive mode (no JSON events)
  threadId: string | null;     // Codex only, for session resumption
  stderr: string | null;
}
```

Interactive mode returns minimal result since no JSON events are captured.

### stdio Handling

| Mode | stdin | stdout | stderr |
|------|-------|--------|--------|
| Non-interactive | pipe (prompt) | pipe (JSON) | pipe (errors) |
| Interactive | inherit | inherit | inherit |

```typescript
const stdio = options.interactive
  ? ["inherit", "inherit", "inherit"]
  : ["pipe", "pipe", "pipe"];

const child = spawn(binary, args, { stdio, env, cwd });
```

### Provider Config

```typescript
// In provider definition
{
  name: "claude-code",
  spawnConfig: {
    modes: ["yolo", "edit", "read"],
    defaultMode: "yolo",
    supportsInteractive: true  // New field
  }
}
```

## Implementation Steps

1. Add `--interactive` / `-i` flag to spawn command
2. Add `interactive` option to SDK `spawn()` function
3. Update each provider's argument builder to handle interactive mode
4. Change stdio to "inherit" for interactive mode
5. Return minimal result for interactive mode (no JSON parsing)
6. Update tests with mocked interactive scenarios

## Testing Strategy

- Unit tests: verify correct args are built for interactive vs non-interactive
- Interactive mode: **manual testing only** (no automated tests for TUI interaction)
- Non-interactive mode: fully tested with mocked JSON streams

## Session Resumption (Non-Interactive)

After a non-interactive Codex session completes, print the resume command to stderr:

```typescript
if (result.threadId) {
  console.error(`\nResume: codex resume -C ${shlex.quote(cwd)} ${result.threadId}`);
}
```

This allows users to continue a session interactively if needed.

## Open Questions

1. How to handle MCP config in interactive mode? (Should work the same)
