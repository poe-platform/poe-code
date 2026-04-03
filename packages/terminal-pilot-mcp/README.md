# terminal-pilot-mcp

MCP server that wraps [terminal-pilot](../terminal-pilot) and exposes terminal automation as MCP tools.

## Run it

Development:

```sh
npx tsx packages/terminal-pilot-mcp/src/cli.ts
```

Built / installed package:

```sh
terminal-pilot-mcp
```

Programmatic:

```ts
import { main } from "terminal-pilot-mcp";

await main();
```

## Connect to an MCP client

**Claude Code** (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "terminal-pilot": {
      "command": "terminal-pilot-mcp"
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "terminal-pilot": {
      "command": "terminal-pilot-mcp"
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "terminal-pilot": {
      "command": "terminal-pilot-mcp"
    }
  }
}
```

## Tools

`void` means the tool returns no payload.

| Tool | Input | Output |
| --- | --- | --- |
| `terminal_create_session` | `{ command: string, args?: string[], cwd?: string, cols?: number, rows?: number, observe?: boolean }` | `{ sessionId: string, pid: number }` |
| `terminal_fill` | `{ sessionId: string, text: string }` | `void` |
| `terminal_type` | `{ sessionId: string, text: string }` | `void` |
| `terminal_press_key` | `{ sessionId: string, key: TerminalKey }` | `void` |
| `terminal_send_signal` | `{ sessionId: string, signal: string }` | `void` |
| `terminal_wait_for` | `{ sessionId: string, pattern: string, timeout?: number, literal?: boolean }` | `{ matched: true, line: string }` |
| `terminal_wait_for_exit` | `{ sessionId: string, timeout?: number }` | `{ exitCode: number }` |
| `terminal_read_screen` | `{ sessionId: string }` | `{ lines: string[], cursor: { row: number, col: number }, size: { rows: number, cols: number }, exitCode: number \| null }` |
| `terminal_read_history` | `{ sessionId: string, last?: number }` | `{ lines: string[], exitCode: number \| null }` |
| `terminal_resize` | `{ sessionId: string, cols: number, rows: number }` | `void` |
| `terminal_close_session` | `{ sessionId: string }` | `{ exitCode: number }` |
| `terminal_get_session` | `{ sessionId: string }` | `{ id: string, pid: number, command: string, exitCode: number \| null }` |
| `terminal_list_sessions` | `{}` | `{ sessions: Array<{ id: string, command: string, pid: number }> }` |

Practical notes:

- `terminal_fill` sends text all at once (`\n` → `\r`). Use for bulk text entry.
- `terminal_type` sends text character-by-character with a small delay between keystrokes. Use for TUI apps that react to each keystroke (vim insert mode, readline, etc.).
- `terminal_wait_for.pattern` is compiled as a JavaScript `RegExp` by default. Set `literal: true` to match the string exactly (no regex interpretation — safe for file names, dots, etc.).
- `terminal_wait_for_exit` blocks until the process exits and returns its exit code. Throws on timeout.
- `terminal_read_screen` and `terminal_read_history` include `exitCode: number | null` so you can check whether the session is still running without a separate call.
- `terminal_get_session` reads session metadata without any side effects — useful for checking `exitCode` before deciding whether to wait or close.
- `terminal_close_session` kills the process (if still running) and removes the session from the server's session map. After this call, the session ID is invalid.
- `terminal_read_screen` returns the **current visible screen**, not scrollback.
- `terminal_read_history` returns ANSI-stripped output since session start.
- `terminal_list_sessions` returns **running** sessions only (sessions whose process has exited are excluded from the list but remain accessible via `terminal_get_session` until `terminal_close_session` is called).
- `observe: true` mirrors PTY output to `stderr`, useful when debugging MCP-driven runs.

Minimal MCP flow:

```json
{"tool":"terminal_create_session","arguments":{"command":"poe-code","args":["configure"]}}
{"tool":"terminal_wait_for","arguments":{"sessionId":"<id>","pattern":"Pick an agent to configure:"}}
{"tool":"terminal_press_key","arguments":{"sessionId":"<id>","key":"Enter"}}
{"tool":"terminal_read_screen","arguments":{"sessionId":"<id>"}}
{"tool":"terminal_close_session","arguments":{"sessionId":"<id>"}}
```

## Environment variables

There are no environment variables specific to this package. The MCP server inherits the process environment; spawned terminal sessions inherit from that unless overridden per session.
