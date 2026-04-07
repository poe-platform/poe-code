# Plan: terminal-pilot CLI

Standalone `terminal-pilot` CLI binary (published as part of the `terminal-pilot` npm package). Mirrors the MCP tools 1:1 — every MCP tool gets a corresponding CLI subcommand with identical parameters. Plus a `screenshot` command leveraging `terminal-png`, and a built-in skill installer.

## Analogy

| MCP Tool | CLI Command | Purpose |
|---|---|---|
| `terminal_create_session` | `terminal-pilot create-session` | Spawn PTY session |
| `terminal_fill` | `terminal-pilot fill` | Write text all at once |
| `terminal_type` | `terminal-pilot type` | Type character-by-character |
| `terminal_press_key` | `terminal-pilot press-key` | Send named key press |
| `terminal_send_signal` | `terminal-pilot send-signal` | Send process signal |
| `terminal_wait_for` | `terminal-pilot wait-for` | Wait for output pattern |
| `terminal_wait_for_exit` | `terminal-pilot wait-for-exit` | Wait for process exit |
| `terminal_read_screen` | `terminal-pilot read-screen` | Read visible screen |
| `terminal_read_history` | `terminal-pilot read-history` | Read output history |
| `terminal_resize` | `terminal-pilot resize` | Resize terminal |
| `terminal_close_session` | `terminal-pilot close-session` | Close session |
| `terminal_get_session` | `terminal-pilot get-session` | Get session metadata |
| `terminal_list_sessions` | `terminal-pilot list-sessions` | List active sessions |
| *(new)* | `terminal-pilot screenshot` | Capture screen as PNG |
| *(installer)* | `terminal-pilot install` | Install skill + MCP server |
| *(installer)* | `terminal-pilot uninstall` | Remove skill + MCP server |

## Session Naming

Sessions are referenced by **human-readable names** instead of UUIDs (Playwright CLI pattern).

### Global option: `-s, --session <name>`

- Short: `-s myapp`
- Long: `--session myapp`
- Env var: `TERMINAL_PILOT_SESSION` (avoids repeating `-s` on every call)

### Behavior

- `create-session -s tests npm test` — creates a session named `tests`
- `read-screen -s tests` — reads the `tests` session's screen
- If `-s` is omitted and only one session exists, it is used implicitly
- If `-s` is omitted and multiple sessions exist, error with list of available sessions
- If `-s` is omitted on `create-session`, auto-names as `s1`, `s2`, ...

### Examples

```bash
# Named sessions
terminal-pilot create-session -s tests npm test
terminal-pilot wait-for -s tests "PASS"
terminal-pilot close-session -s tests

# Single session — no -s needed
terminal-pilot create-session npm test
terminal-pilot read-screen

# Env var
export TERMINAL_PILOT_SESSION=tests
terminal-pilot read-screen
terminal-pilot close-session
```

UUID remains an internal implementation detail. The CLI maps `name → sessionId` internally.

## cmdkit Integration

Commands are defined using `defineCommand`/`defineGroup` from `@poe-code/cmdkit`. The existing cmdkit package already provides subpath exports for each runner:

- `@poe-code/cmdkit` — `defineCommand`, `defineGroup`, types, `S`
- `@poe-code/cmdkit/cli` — `runCLI`
- `@poe-code/cmdkit/mcp` — `runMCP`
- `@poe-code/cmdkit/sdk` — `createSDK`

The `terminal-pilot` package uses the same subpath pattern for its entry points:

```
terminal-pilot           — core SDK (TerminalPilot, TerminalSession, TerminalScreen)
terminal-pilot/commands  — defineCommand/defineGroup definitions
terminal-pilot/cli       — CLI binary (runCLI)
terminal-pilot/mcp       — MCP server (runMCP)
```

### Composable definitions

Command definitions are **data** — plain objects with a handler function. They don't know about CLI, MCP, or SDK. Any runner can consume them:

```typescript
// packages/terminal-pilot/src/commands/create-session.ts
// Pure definition — depends only on cmdkit-schema types
import { defineCommand, S } from "@poe-code/cmdkit";

export const createSession = defineCommand({
  name: "create-session",
  description: "Spawn an interactive CLI in a PTY",
  scope: ["cli", "mcp", "sdk"],
  params: S.Object({
    command: S.String({ description: "Command to execute" }),
    args: S.Optional(S.Array(S.String(), { description: "Command arguments" })),
    session: S.Optional(S.String({ short: "s", description: "Session name" })),
    cwd: S.Optional(S.String({ description: "Working directory" })),
    cols: S.Optional(S.Number({ description: "Terminal width in columns" })),
    rows: S.Optional(S.Number({ description: "Terminal height in rows" })),
    observe: S.Optional(S.Boolean({ description: "Mirror PTY output to stderr" })),
  }),
  handler: async ({ params }) => {
    const session = await pilot.newSession(params);
    return { session: session.name, pid: session.pid };
  },
});

// packages/terminal-pilot/src/commands/index.ts
import { defineGroup } from "@poe-code/cmdkit";
export const terminalPilotGroup = defineGroup({
  name: "terminal-pilot",
  children: [createSession, fill, type, pressKey, /* ... all 13 commands */],
});
```

```typescript
// packages/terminal-pilot/src/cli.ts
// Pulls in cmdkit/cli (commander, design-system) — only when this entry point is used
import { runCLI } from "@poe-code/cmdkit/cli";
import { terminalPilotGroup } from "./commands/index.js";

runCLI(terminalPilotGroup);
```

```typescript
// packages/terminal-pilot/src/mcp.ts
// Pulls in cmdkit/mcp (@modelcontextprotocol/sdk) — never touches commander
import { runMCP } from "@poe-code/cmdkit/mcp";
import { terminalPilotGroup } from "./commands/index.js";

runMCP(terminalPilotGroup, { name: "terminal-pilot", version: "0.0.1" });
```

Every entry point is just 3 lines: import runner, import definitions, run. The definitions don't care who consumes them.

### Mounting multiple definitions

Runners accept a single group or an array of groups — compose tools from different packages into one server or CLI:

```typescript
// Compose multiple packages into one MCP server
import { runMCP } from "@poe-code/cmdkit/mcp";
import { terminalPilotGroup } from "terminal-pilot/commands";
import { terminalPngGroup } from "terminal-png/commands";

runMCP([terminalPilotGroup, terminalPngGroup], {
  name: "terminal-tools",
  version: "0.0.1",
});
// Exposes: terminal-pilot.create-session, terminal-pilot.fill, ..., terminal-png.render
```

```typescript
// Compose multiple packages into one CLI
import { runCLI } from "@poe-code/cmdkit/cli";
import { terminalPilotGroup } from "terminal-pilot/commands";
import { screenshotCommand } from "./screenshot.js";

runCLI(defineGroup({
  name: "terminal-pilot",
  children: [...terminalPilotGroup.children, screenshotCommand],
}));
```

### What changes in cmdkit

1. **`runMCP` and `runCLI` accept arrays**
   ```typescript
   export async function runMCP(roots: Group | Group[], options: RunMCPOptions): Promise<void>;
   export async function runCLI(roots: Group | Group[], options?: RunCLIOptions): Promise<void>;
   ```
   This enables composing multiple definition sets into one server or CLI.

## Architecture

The CLI is a **long-running process** — it launches a `TerminalPilot` instance and keeps it alive across multiple subcommand invocations. This is critical because sessions are stateful (PTY processes must persist between commands).

Two modes of operation:

### Interactive REPL mode (default)

```bash
terminal-pilot
# Enters REPL:
# terminal-pilot> create-session -s tests npm test
# → session: tests, pid: 45678
# terminal-pilot> wait-for -s tests "PASS"
# → matched: true, line: "Tests: 5 passed"
# terminal-pilot> close-session -s tests
# → exitCode: 0
```

### One-shot mode (pipe-friendly)

```bash
# Create session and get JSON output
terminal-pilot create-session --json -s tests "npm test"
# → {"session":"tests","pid":45678}

# Read screen (env var)
TERMINAL_PILOT_SESSION=tests terminal-pilot read-screen --json
# → {"lines":[...],"cursor":{"row":3,"col":0},"size":{"rows":40,"cols":120}}
```

One-shot mode creates a TerminalPilot per invocation. Sessions do not persist across invocations. Useful for scripting simple flows (create → wait → read → close in a single pipeline) but the REPL is the primary UX.

## 1. CLI Commands — MCP Mirror

All commands live under `terminal-pilot <subcommand>`. Each mirrors its MCP counterpart exactly.

### `create-session <command> [args...]`

Spawn a PTY session. Prints session name and pid.

```bash
terminal-pilot create-session npm test
terminal-pilot create-session -s tests npm test
terminal-pilot create-session --cols 160 --rows 50 htop
terminal-pilot create-session --cwd /tmp --observe bash
```

**Options:**
- `-s, --session <name>` — session name (default: auto-generated)
- `--cols <n>` — terminal columns (default: 120)
- `--rows <n>` — terminal rows (default: 40)
- `--cwd <dir>` — working directory
- `--observe` — mirror PTY output to stderr

### `fill <text>`

Write text all at once (replaces `\n` with `\r`).

```bash
terminal-pilot fill "hello world\n"
terminal-pilot fill -s tests "hello world\n"
```

### `type <text>`

Type text character-by-character with delay.

```bash
terminal-pilot type "ls -la"
terminal-pilot type -s tests "ls -la"
```

### `press-key <key>`

Send a named key press.

```bash
terminal-pilot press-key Enter
terminal-pilot press-key -s tests "Control+c"
terminal-pilot press-key Tab
```

### `send-signal <signal>`

Send a process signal.

```bash
terminal-pilot send-signal SIGINT
terminal-pilot send-signal -s tests SIGTERM
```

### `wait-for <pattern>`

Wait for terminal output to match a pattern. Prints matched line.

```bash
terminal-pilot wait-for "PASS"
terminal-pilot wait-for -s tests --timeout 5000 "ready"
terminal-pilot wait-for --literal "error: not found"
```

**Options:**
- `-s, --session <name>` — target session
- `-t, --timeout <ms>` — max wait time (default: 10000)
- `-l, --literal` — treat pattern as literal string instead of regex

### `wait-for-exit`

Wait for session process to exit. Prints exit code.

```bash
terminal-pilot wait-for-exit
terminal-pilot wait-for-exit -s tests --timeout 30000
```

**Options:**
- `-s, --session <name>` — target session
- `-t, --timeout <ms>` — max wait time

### `read-screen`

Read current visible terminal screen. Prints lines, cursor position, size, and exit code.

```bash
terminal-pilot read-screen
terminal-pilot read-screen -s tests
```

### `read-history`

Read terminal output history.

```bash
terminal-pilot read-history
terminal-pilot read-history -s tests --last 20
```

**Options:**
- `-s, --session <name>` — target session
- `-n, --last <n>` — return only the last N lines

### `resize <cols> <rows>`

Resize an active terminal session.

```bash
terminal-pilot resize 160 50
terminal-pilot resize -s tests 160 50
```

### `close-session`

Close session and print exit code.

```bash
terminal-pilot close-session
terminal-pilot close-session -s tests
```

### `get-session`

Get session metadata (name, pid, command, exitCode).

```bash
terminal-pilot get-session
terminal-pilot get-session -s tests
```

### `list-sessions`

List all active sessions (names, commands, pids).

```bash
terminal-pilot list-sessions
```

## 2. Extra CLI commands (not in MCP)

### `screenshot`

Captures the current screen of an existing session as PNG using `@poe-code/terminal-png`.

```bash
terminal-pilot screenshot -o screen.png
terminal-pilot screenshot -s tests -o screen.png
terminal-pilot screenshot -s tests --no-window -o screen.png
```

**Options:**
- `-o, --output <file>` — output PNG path (required)
- `-s, --session <name>` — target session
- `--window` — add macOS window chrome (default: true)
- `--no-window` — disable window chrome
- `-p, --padding <n>` — padding in pixels (default: 20)

**Implementation:** Gets `session.screen()` raw ANSI lines, passes to `@poe-code/terminal-png` for rendering. For standalone screenshot of a command, use `terminal-png` directly.

## 3. Skill: `terminal-pilot`

A bundled skill that teaches agents how to use the terminal-pilot MCP tools.

### Skill template

File: `packages/agent-skill-config/src/templates/terminal-pilot.md`

```markdown
---
name: terminal-pilot
description: 'Terminal automation skill using poe-code terminal-pilot MCP'
---

# Terminal Pilot

Use the terminal-pilot MCP tools to automate and interact with CLI applications
through real PTY sessions.

## Quick start

1. Create a session:
   Use `terminal_create_session` with the command to run.

2. Interact:
   - `terminal_fill` — paste text (fast, for non-interactive input)
   - `terminal_type` — type character by character (for TUI apps, readline)
   - `terminal_press_key` — press special keys (Enter, Tab, ArrowUp, Escape, Control+c)

3. Observe:
   - `terminal_read_screen` — get current visible screen (lines, cursor, size)
   - `terminal_read_history` — get scrollback buffer
   - `terminal_wait_for` — block until pattern appears (regex or literal)
   - `terminal_wait_for_exit` — block until process exits

4. Manage:
   - `terminal_list_sessions` — list active sessions
   - `terminal_close_session` — close a session and get exit code

## Patterns

### Run a command and read output
```
terminal_create_session({ command: "git", args: ["status"] })
terminal_wait_for_exit({ sessionId })
terminal_read_screen({ sessionId })
```

### Interactive TUI
```
terminal_create_session({ command: "vim", args: ["file.txt"] })
terminal_wait_for({ sessionId, pattern: "file.txt" })
terminal_type({ sessionId, text: "iHello World" })
terminal_press_key({ sessionId, key: "Escape" })
terminal_type({ sessionId, text: ":wq" })
terminal_press_key({ sessionId, key: "Enter" })
```

### Send signals
```
terminal_send_signal({ sessionId, signal: "SIGINT" })
```

## Tips

- Use `terminal_fill` for pasting multi-line text or non-interactive input
- Use `terminal_type` when the app reacts to individual keystrokes (vim, fzf, readline)
- Use `terminal_wait_for` with `literal: true` for exact string matching
- Default terminal size is 120x40; resize with `terminal_resize`
- Sessions persist until explicitly closed or the MCP server exits
```

### Installer: `terminal-pilot install [agent]`

Subcommand on the `terminal-pilot` CLI that installs both:
1. The skill file (SKILL.md) via `installSkill()`
2. The MCP server config via `@poe-code/agent-mcp-config`

```bash
# Interactive — prompts for agent
terminal-pilot install

# Direct
terminal-pilot install claude-code

# Scope
terminal-pilot install claude-code --local
terminal-pilot install claude-code --global

# Uninstall
terminal-pilot uninstall claude-code
```

**What `install` does:**
1. Writes `SKILL.md` to agent's skill directory (`installSkill()`)
2. Registers `terminal-pilot-mcp` as an MCP server in the agent's config
   - command: `npx terminal-pilot-mcp` (or resolved binary path)
   - transport: stdio

**What `uninstall` does:**
1. Removes the skill folder
2. Removes the MCP server registration

## 4. File Layout

### `terminal-pilot` package — four entry points

```
packages/terminal-pilot/src/
  index.ts                     — core SDK exports (TerminalPilot, TerminalSession, etc.)
  cli.ts                       — runCLI(terminalPilotGroup) — bin: terminal-pilot
  cli.test.ts
  commands/
    create-session.ts          — defineCommand
    fill.ts
    type.ts
    press-key.ts
    send-signal.ts
    wait-for.ts
    wait-for-exit.ts
    read-screen.ts
    read-history.ts
    resize.ts
    close-session.ts
    get-session.ts
    list-sessions.ts
    screenshot.ts              — scope: ["cli"] only
    index.ts                   — defineGroup, exported via terminal-pilot/commands
```

`package.json`:
```json
{
  "bin": {
    "terminal-pilot": "dist/cli.js"
  },
  "exports": {
    ".":          { "import": "./dist/index.js" },
    "./commands": { "import": "./dist/commands/index.js" },
    "./cli":      { "import": "./dist/cli.js" }
  },
  "dependencies": {
    "@poe-code/cmdkit": "*",
    "@poe-code/cmdkit-schema": "*",
    "terminal-png": "*",
    "node-pty": "^1.1.0"
  }
}
```

The `terminal-pilot-mcp` package stays separate but is rewritten to import definitions from `terminal-pilot/commands` and run them via `@poe-code/cmdkit/mcp`.

### Installer commands (part of `terminal-pilot` package)

The `install`/`uninstall` commands are defined as `defineCommand` in the commands directory, scoped to `["cli"]`:

```
packages/terminal-pilot/src/commands/install.ts     — defineCommand for install
packages/terminal-pilot/src/commands/uninstall.ts   — defineCommand for uninstall
```

These commands use `@poe-code/agent-skill-config` (for SKILL.md installation) and `@poe-code/agent-mcp-config` (for MCP server registration). Since those are internal unpublished packages, they are **bundled** into the `terminal-pilot` build output. This is the pattern for any published package in this repo that needs internal deps — bundle them, don't publish them separately.

### New skill template

```
packages/agent-skill-config/src/templates/terminal-pilot.md
```

## 5. Output Format (handled by cmdkit)

All commands output structured data. Two modes:

- **Human mode (default):** Formatted using `@poe-code/design-system` (tables, headings, etc.)
- **JSON mode (`--json`):** Raw JSON to stdout for scripting

Example: `read-screen` human output:
```
Screen (120x40) | Cursor: row 3, col 0 | Exit: running

  1 │ $ npm test
  2 │
  3 │ > my-app@1.0.0 test
  4 │ > vitest run
  5 │
  6 │ ✓ src/index.test.ts (3 tests) 12ms
  7 │ Tests: 3 passed
```

Example: `read-screen --json` output:
```json
{"lines":["$ npm test","","> my-app@1.0.0 test","> vitest run","","✓ src/index.test.ts (3 tests) 12ms","Tests: 3 passed"],"cursor":{"row":3,"col":0},"size":{"rows":40,"cols":120},"exitCode":null}
```

## 6. Global `--json` flag

Add `--json` as a global option on the `terminal-pilot` parent command. All subcommands check it and switch output format accordingly.

## 7. Dependency Summary

Two packages, clean dep boundaries:

```
terminal-pilot             → node-pty
terminal-pilot/commands    → @poe-code/cmdkit, @poe-code/cmdkit-schema
terminal-pilot/cli         → @poe-code/cmdkit/cli (commander, design-system)

terminal-pilot-mcp         → @poe-code/cmdkit/mcp (@modelcontextprotocol/sdk)
                           → terminal-pilot/commands
```

## 8. Implementation Order

1. **cmdkit: array support** — update `runMCP`/`runCLI` to accept `Group | Group[]`
2. **Command definitions** — define all 13 commands as `defineCommand` in `packages/terminal-pilot/src/commands/`
3. **CLI entry point** — `packages/terminal-pilot/src/cli.ts` using `runCLI`
4. **Rewrite `terminal-pilot-mcp`** — import definitions from `terminal-pilot/commands`, use `runMCP`
5. **Screenshot command** — CLI-only scope, uses terminal-png
6. **QA** — run `docs/development/qa-terminal-pilot-mcp.md` test suite using CLI commands
7. **Skill template** — `terminal-pilot.md` in agent-skill-config
8. **Installer** — `terminal-pilot install/uninstall` in main package
