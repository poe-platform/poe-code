# terminal-pilot MCP improvements

## 1. Rename `terminal_type` → `terminal_fill`, expose `terminal_type`

**Problem:** `terminal_type` MCP tool calls `session.fill()` (sends all at once). For TUI apps reacting keystroke-by-keystroke (vim insert mode, readline), this is wrong. The naming is also misleading.

**Fix:**
- Rename existing MCP tool to `terminal_fill` — sends text at once, replaces `\n`→`\r`
- Add `terminal_type` — calls `session.type()`, sends character-by-character with delay

## 2. Add `terminal_wait_for_exit`

**Problem:** No way to wait for a process to finish cleanly. Workarounds are polling `wait_for` on a guess-pattern, or calling `close_session` (which may SIGTERM a running process).

**Fix:** New tool:
```
terminal_wait_for_exit(sessionId, timeout?)
→ { exitCode: number }
```
Wraps `session.exitPromise` with an optional timeout. Returns exit code or throws on timeout.

## 3. Fix `wait_for` literal string matching

**Problem:** MCP handler wraps all patterns in `new RegExp(input.pattern)`. A literal `"file.txt"` matches `filextxt`. Callers who pass plain strings don't expect regex semantics.

**Fix:** Add a `literal` boolean param (default `false`). When `true`, escape the string before wrapping in RegExp:
```
terminal_wait_for(sessionId, pattern, timeout?, literal?)
```
Or: document clearly that `pattern` is always a regex (at minimum).

## 4. Expose `exitCode` on session tools

**Problem:** No way to check whether a session has finished or what its exit code was, short of calling `close_session` (which may kill a running process).

**Fix:** Return `exitCode: number | null` from:
- `terminal_read_screen` response
- `terminal_read_history` response
- `terminal_close_session` response (already returns `exitCode`, this is fine)

Also add `terminal_get_session` to read session metadata (pid, command, exitCode) without side effects.

## 5. Explicit session removal on `terminal_close_session`

**Problem:** After the auto-delete-on-exit bug fix (sessions now persist), calling `close_session` closes the process but leaves the session in the map. Follow-up calls to `read_screen` / `read_history` still succeed (fine), but the session is never evicted until the MCP server process dies.

**Fix:** `terminal_close_session` handler deletes the session from the map after closing:
```ts
await agent.getSession(id).close();
agent.deleteSession(id); // new method: just sessionMap.delete(id)
```
Add `deleteSession(id)` to `TerminalPilot` (close + remove from map is the right semantic).
