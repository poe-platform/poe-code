---
name: terminal-pilot
description: "Terminal automation skill using poe-code terminal-pilot MCP"
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

```text
terminal_create_session({ command: "git", args: ["status"] })
terminal_wait_for_exit({ sessionId })
terminal_read_screen({ sessionId })
```

### Interactive TUI

```text
terminal_create_session({ command: "vim", args: ["file.txt"] })
terminal_wait_for({ sessionId, pattern: "file.txt" })
terminal_type({ sessionId, text: "iHello World" })
terminal_press_key({ sessionId, key: "Escape" })
terminal_type({ sessionId, text: ":wq" })
terminal_press_key({ sessionId, key: "Enter" })
```

### Send signals

```text
terminal_send_signal({ sessionId, signal: "SIGINT" })
```

## Tips

- Use `terminal_fill` for pasting multi-line text or non-interactive input
- Use `terminal_type` when the app reacts to individual keystrokes (vim, fzf, readline)
- Use `terminal_wait_for` with `literal: true` for exact string matching
- Default terminal size is 120x40; resize with `terminal_resize`
- Sessions persist until explicitly closed or the MCP server exits
