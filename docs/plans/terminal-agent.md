# Terminal Agent

A Playwright-like SDK + MCP server for automating interactive CLI applications via pseudoterminals. AI agents use the MCP tools to test interactive CLI flows — the same way Playwright MCP lets agents test browsers.

## Motivation

We can't test our own CLI. Even basic flows like `poe-code configure` — which prompts for agent, model, and confirms — are untestable today. The command uses interactive prompts (arrow key menus, text input, confirmations) that require a real terminal. `spawn(..., { interactive: true })` inherits stdio and does not emit ACP events, so there is no automation surface.

This applies to most of our CLI surface: `poe-code configure`, `poe-code ralph run`, `poe-code spawn` interactive mode, model/agent selection menus, confirmation prompts. Every change to these flows is manually verified today. No regression coverage, no agent-driven smoke tests, no CI for prompt flows.

We need a PTY-backed automation layer that lets code drive interactive apps the way Playwright drives browsers: structured session objects, keystroke control, pattern matching, and normalized screen state.

The MCP server is the primary interface — it exposes terminal automation as tools so that AI agents (Claude Code, poe-code agent, etc.) can launch, interact with, and assert on interactive CLI apps during testing.

## Goals

- Playwright-like stateful SDK: `TerminalAgent` → `TerminalSession` → `TerminalScreen`
- MCP server exposing the SDK as tools for AI agent use
- Spawn any CLI app in a real pseudoterminal
- Send keystrokes, text input, and signals
- Wait for output patterns (expect-style)
- Read normalized screen state (lines, cursor, dimensions) — not raw ANSI
- Multi-session support

## Non-goals (v1)

- CLI wrapper for manual debugging
- Visual diffing / screenshot comparison
- Multi-user session attach
- Persistent daemon mode
- Browser-based terminal viewer

## Dependencies

| Dependency | Purpose |
|---|---|
| `node-pty` (1.x) | PTY process spawning, I/O, resize, signals |
| `headless-terminal` | ANSI parsing, screen buffer state |

No expect-style libraries — we build a thin `waitFor` loop over the PTY output buffer directly. Fewer deps, better control.

### Headless vs Observable Mode

By default, terminal-agent runs **headless** — the PTY output is captured in-memory and never displayed. This is the right mode for automated testing and agent use.

For debugging and development, sessions support an **observable mode** that mirrors PTY output to the caller's stdout in real-time, so you can watch what the app is doing:

```ts
const session = await agent.newSession({
  command: "poe-code",
  args: ["configure"],
  observe: true,  // mirror PTY output to process.stdout
})
```

In MCP context, `terminal_create_session` accepts an optional `observe: true` parameter. When enabled, the MCP server pipes raw PTY output to stderr (so it doesn't interfere with the JSON-RPC stdio transport). This lets the developer running the MCP server see the terminal in real time while the agent drives it.

Both modes produce identical `screen()` / `history()` results — `observe` only controls whether output is also mirrored for human consumption.

## API Design

### Object model

```
TerminalAgent       — manages sessions (like Playwright Browser)
  TerminalSession   — one PTY process (like Playwright Page)
    TerminalScreen  — normalized screen snapshot (like Playwright accessibility tree)
```

### TerminalAgent

```ts
import { TerminalAgent } from "@poe-code/terminal-agent"

const agent = await TerminalAgent.launch()

const session = await agent.newSession({
  command: "poe-code",
  args: ["configure"],
  cwd: "/my/project",
  env: process.env,
  cols: 120,
  rows: 40,
})

const sessions = agent.sessions()  // list active sessions

await agent.close()  // close all sessions
```

### TerminalSession

```ts
// Text input
await session.type("hello world")     // types characters one by one
await session.fill("hello world")     // writes entire string at once

// Keystrokes
await session.press("Enter")
await session.press("ArrowDown")
await session.press("ArrowUp")
await session.press("Tab")
await session.press("Escape")
await session.press("Control+c")
await session.press("Control+d")

// Raw input (escape sequences, etc.)
await session.send("\x1b[B")

// Signals
await session.signal("SIGINT")
await session.signal("SIGTERM")

// Waiting
await session.waitFor(/Select an option/)           // regex match on output
await session.waitFor("Ready", { timeout: 5000 })   // string match with timeout
await session.waitForQuiet(500)                      // wait until no output for N ms

// Screen state
const screen = await session.screen()

// History (all output since session start, ANSI-stripped)
const history = await session.history()
const recent = await session.history({ last: 50 })  // last N lines

// Resize
await session.resize(80, 24)

// Lifecycle
await session.close()               // graceful close
session.pid                          // underlying process PID
session.exitCode                     // null until closed
session.on("exit", (code) => {})     // exit event
```

### TerminalScreen

```ts
const screen = await session.screen()

screen.lines        // string[] — visible lines, ANSI-stripped
screen.rawLines     // string[] — visible lines, raw with ANSI
screen.cursor       // { row: number, col: number }
screen.size         // { rows: number, cols: number }
screen.text         // full screen as single string (lines joined with \n)

// Convenience
screen.contains("Select an option")   // boolean
screen.line(0)                         // first visible line
screen.line(-1)                        // last visible line
```

### Key mapping

```ts
type TerminalKey =
  | "Enter" | "Tab" | "Escape" | "Backspace" | "Delete"
  | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
  | "Home" | "End" | "PageUp" | "PageDown"
  | "Space"
  | `Control+${string}`
  | `Alt+${string}`
```

Maps to ANSI escape sequences internally:

| Key | Sequence |
|---|---|
| Enter | `\r` |
| Tab | `\t` |
| Escape | `\x1b` |
| ArrowUp | `\x1b[A` |
| ArrowDown | `\x1b[B` |
| ArrowRight | `\x1b[C` |
| ArrowLeft | `\x1b[D` |
| Control+c | `\x03` |
| Control+d | `\x04` |
| Backspace | `\x7f` |
| Delete | `\x1b[3~` |

### Options

```ts
interface NewSessionOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  cols?: number   // default: 120
  rows?: number   // default: 40
}

interface WaitForOptions {
  timeout?: number   // default: 10000ms
}

interface HistoryOptions {
  last?: number      // return only last N lines
}
```

## MCP Server

The MCP server is a thin adapter over the SDK. It is the primary way AI agents interact with terminal-agent.

### Tools

#### `terminal_create_session`

Spawn an interactive CLI app in a PTY.

```json
{
  "command": "poe-code",
  "args": ["configure"],
  "cwd": "/my/project",
  "cols": 120,
  "rows": 40
}
```

Returns: `{ "sessionId": "abc123", "pid": 4567 }`

#### `terminal_type`

Type text into the active session.

```json
{
  "sessionId": "abc123",
  "text": "hello world"
}
```

#### `terminal_press_key`

Send a named keystroke.

```json
{
  "sessionId": "abc123",
  "key": "ArrowDown"
}
```

Supported keys: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `Space`, `Control+c`, `Control+d`, `Control+z`, `Alt+<key>`.

#### `terminal_send_signal`

Send a process signal.

```json
{
  "sessionId": "abc123",
  "signal": "SIGINT"
}
```

#### `terminal_wait_for`

Wait until output matches a pattern. Returns the matched output.

```json
{
  "sessionId": "abc123",
  "pattern": "Select.*agent",
  "timeout": 5000
}
```

Returns: `{ "matched": true, "output": "Select an agent:" }`

#### `terminal_read_screen`

Read the current visible terminal state, normalized (ANSI-stripped).

```json
{
  "sessionId": "abc123"
}
```

Returns:

```json
{
  "lines": ["Select an agent:", "  > claude", "    codex", "    kimi"],
  "cursor": { "row": 1, "col": 4 },
  "size": { "rows": 40, "cols": 120 }
}
```

#### `terminal_read_history`

Read all output since session start (ANSI-stripped).

```json
{
  "sessionId": "abc123",
  "last": 50
}
```

Returns: `{ "lines": ["...", "..."] }`

#### `terminal_resize`

Resize the terminal.

```json
{
  "sessionId": "abc123",
  "cols": 80,
  "rows": 24
}
```

#### `terminal_close_session`

Close a session and kill the process.

```json
{
  "sessionId": "abc123"
}
```

Returns: `{ "exitCode": 0 }`

#### `terminal_list_sessions`

List all active sessions.

Returns: `{ "sessions": [{ "id": "abc123", "command": "poe-code", "pid": 4567 }] }`

### MCP Server Implementation

The server uses `@poe-code/tiny-stdio-mcp-server` and holds a single `TerminalAgent` instance. Each tool call delegates to the SDK. Session state lives in-memory on the server — sessionIds are opaque strings returned to the agent.

```ts
import { createServer } from "@poe-code/tiny-stdio-mcp-server"
import { TerminalAgent } from "./terminal-agent.js"

const agent = await TerminalAgent.launch()
const server = createServer({ name: "terminal-agent", version: "0.1.0" })

server
  .tool("terminal_create_session", "Spawn an interactive CLI in a PTY", schema, async (input) => {
    const session = await agent.newSession(input)
    return { sessionId: session.id, pid: session.pid }
  })
  .tool("terminal_press_key", "Send a keystroke", schema, async (input) => {
    const session = agent.getSession(input.sessionId)
    await session.press(input.key)
  })
  // ... etc

server.listen()
```

### Agent Usage Example

When the AI agent needs to test an interactive CLI flow:

1. Agent calls `terminal_create_session` with the CLI command
2. Agent calls `terminal_wait_for` to wait for a prompt
3. Agent calls `terminal_read_screen` to see the current state
4. Agent calls `terminal_press_key` or `terminal_type` to interact
5. Agent repeats 2-4 until the flow completes
6. Agent calls `terminal_close_session` to clean up

This is the terminal equivalent of Playwright MCP's `browser_navigate` → `browser_snapshot` → `browser_click` loop.

## Internal Architecture

```
TerminalAgent
  └─ Map<id, SessionHandle>

SessionHandle
  ├─ node-pty IPty instance
  ├─ headless-terminal instance (fed raw PTY output)
  ├─ raw output buffer (string, append-only)
  └─ event emitter (exit, data)
```

Flow:
1. `newSession()` → `pty.spawn()` → creates IPty + headless terminal
2. `pty.onData(chunk)` → append to raw buffer + feed to headless terminal
3. `type()` / `press()` / `send()` → `pty.write()`
4. `signal()` → `pty.kill(signal)`
5. `waitFor()` → poll raw buffer for pattern match
6. `screen()` → read headless terminal state → normalize to `TerminalScreen`
7. `history()` → strip ANSI from raw buffer → split into lines
8. `close()` → `pty.kill("SIGTERM")` → wait for exit → cleanup

## Package Structure

```
packages/terminal-agent/
├── package.json
├── README.md
├── tsconfig.json
├── src/
│   ├── index.ts                    # public SDK exports
│   ├── terminal-agent.ts           # TerminalAgent class
│   ├── terminal-session.ts         # TerminalSession class
│   ├── terminal-screen.ts          # TerminalScreen class
│   ├── keys.ts                     # key name → escape sequence mapping
│   ├── ansi.ts                     # ANSI stripping utilities
│   ├── mcp-server.ts              # MCP server entry point
│   ├── mcp-tools.ts               # MCP tool definitions
│   ├── terminal-agent.test.ts
│   ├── terminal-session.test.ts
│   ├── terminal-screen.test.ts
│   ├── keys.test.ts
│   ├── ansi.test.ts
│   ├── mcp-server.test.ts
│   └── mcp-tools.test.ts
```

`package.json` exports both the SDK and a bin entry for the MCP server:

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./mcp": { "types": "./dist/mcp-server.d.ts", "import": "./dist/mcp-server.js" }
  },
  "bin": {
    "terminal-agent-mcp": "dist/mcp-server.js"
  }
}
```

## Testing Strategy

### Unit tests

- `keys.ts` — key name to escape sequence mapping (pure, no PTY)
- `ansi.ts` — ANSI stripping (pure, no PTY)
- `terminal-screen.ts` — screen construction from headless terminal state (mock the terminal state)

### Integration tests

- `terminal-session.ts` — spawn a real process (e.g. `cat`, `sh`, or a simple test CLI), send input, verify output
- `terminal-agent.ts` — multi-session lifecycle, cleanup on close
- `mcp-tools.ts` — end-to-end MCP tool calls: create session → interact → read screen → close
- `mcp-server.ts` — server lifecycle, tool registration

Integration tests use real PTY — they are inherently slower but necessary. Keep them focused and small.

### Smoke test fixture

Create a tiny interactive CLI fixture for testing:

```ts
// src/testing/test-cli.ts
// A minimal interactive program: prompts for name, echoes it, exits
import * as readline from "readline"
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.question("What is your name? ", (answer) => {
  console.log(`Hello, ${answer}!`)
  rl.close()
})
```

Use this in integration tests instead of depending on external CLIs.

## Implementation Order

1. `keys.ts` + tests — key mapping, pure functions
2. `ansi.ts` + tests — ANSI strip utility
3. `terminal-screen.ts` + tests — screen snapshot model
4. `terminal-session.ts` + integration tests — PTY session with real process
5. `terminal-agent.ts` + tests — multi-session management
6. `index.ts` — public SDK surface
7. `mcp-tools.ts` + tests — MCP tool definitions over the SDK
8. `mcp-server.ts` + tests — MCP stdio server entry point
9. `README.md` — usage docs, SDK API, MCP tool reference

## Example Usage

### Testing a poe-code configure flow

```ts
import { TerminalAgent } from "@poe-code/terminal-agent"

const agent = await TerminalAgent.launch()
const session = await agent.newSession({
  command: "poe-code",
  args: ["configure"],
})

// Wait for agent selection prompt
await session.waitFor(/Select.*agent/i)
const screen = await session.screen()
expect(screen.contains("claude")).toBe(true)

// Select claude
await session.press("Enter")

// Wait for model prompt
await session.waitFor(/Select.*model/i)
await session.press("Enter")

// Wait for completion
await session.waitFor(/configured/i)

await session.close()
await agent.close()
```

### Testing arrow key navigation

```ts
const session = await agent.newSession({
  command: "my-menu-app",
})

await session.waitFor(/Option 1/)

// Navigate down twice
await session.press("ArrowDown")
await session.press("ArrowDown")

const screen = await session.screen()
// Screen shows cursor on option 3
expect(screen.contains("> Option 3")).toBe(true)

await session.press("Enter")
await session.waitFor(/You selected: Option 3/)
```

## Open Questions

1. **headless-terminal vs @xterm/headless** — `headless-terminal` is simpler but less maintained. `@xterm/headless` is from the xterm.js project but may have access/import issues. Spike both during implementation.
2. **Bun compatibility** — node-pty has native bindings. Bun has its own PTY support via `Bun.spawn({ terminal: true })`. May need a platform adapter layer if we migrate to Bun fully.
3. **Screen refresh timing** — TUI apps redraw frequently. `screen()` may catch mid-render state. Consider adding `waitForStable(timeout)` that waits until screen stops changing.
