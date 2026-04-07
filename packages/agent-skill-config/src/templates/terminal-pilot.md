---
name: terminal-pilot
description: 'Terminal automation skill using the terminal-pilot CLI'
---

# Terminal Pilot

Use the `terminal-pilot` CLI when you need to automate or inspect interactive
CLI applications through a real PTY session.

## Commands

- `terminal-pilot create-session` - start a PTY-backed command
- `terminal-pilot fill` - paste text into a session
- `terminal-pilot type` - type character-by-character for TUIs and readline
- `terminal-pilot press-key` - send named keys such as `Enter` or `ArrowDown`
- `terminal-pilot wait-for` - wait for terminal output to match a pattern
- `terminal-pilot wait-for-exit` - block until a session exits
- `terminal-pilot read-screen` - inspect the current visible terminal screen
- `terminal-pilot read-history` - read scrollback output
- `terminal-pilot list-sessions` - list active sessions
- `terminal-pilot close-session` - close a session and return its exit code

## Examples

```bash
terminal-pilot --help
terminal-pilot create-session --help
terminal-pilot read-screen --help
```

Use JSON output when another tool or script needs to read the result:

```bash
terminal-pilot list-sessions --output json
terminal-pilot read-screen --session s1 --output json
```

## Tips

- Use `fill` for pasted text and multi-line input.
- Use `type` when the app reacts to individual keystrokes.
- Use `press-key` for Enter, Tab, arrow keys, Escape, and control-key chords.
- Use `wait-for --literal` for exact string matching.
- Default terminal size is 120x40.
