# QA: terminal-pilot MCP tools

Fixtures used throughout:
- **test-cli**: `node_modules/.bin/tsx packages/terminal-pilot/src/testing/test-cli.ts` — prompts "What is your name?", reads input, prints "Hello, <name>!"
- **menu-cli**: `node_modules/.bin/tsx packages/terminal-pilot/src/testing/menu-cli.ts` — shows "Select an option:", 3 items (Option 1/2/3), navigate with ArrowUp/ArrowDown, confirm with Enter, prints "You selected: Option <N>"

---

## 1. Empty session list

```
terminal_list_sessions {}
```
Assert: `sessions` is an empty array.

---

## 2. Create a session

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Assert: response contains `sessionId` (non-empty string) and `pid` (number > 0). Save `sessionId` as **S1**.

---

## 3. Session appears in list

```
terminal_list_sessions {}
```
Assert: `sessions` has exactly one entry with `id == S1`.

---

## 4. Get session metadata

```
terminal_get_session { sessionId: S1 }
```
Assert: `id == S1`, `pid > 0`, `command` contains "tsx", `exitCode == null`.

---

## 5. Wait for prompt

```
terminal_wait_for { sessionId: S1, pattern: "What is your name?" }
```
Assert: `matched == true`, `line` contains "What is your name?".

---

## 6. Fill text

```
terminal_fill { sessionId: S1, text: "Alice\n" }
```
Assert: no error.

---

## 7. Wait for greeting

```
terminal_wait_for { sessionId: S1, pattern: "Hello, Alice!" }
```
Assert: `matched == true`.

---

## 8. Read screen includes exitCode null

```
terminal_read_screen { sessionId: S1 }
```
Assert: `lines` is an array of strings, `cursor` has `row` and `col`, `size` has `rows` and `cols`, `exitCode == null`.

---

## 9. Read history includes all output, exitCode null

```
terminal_read_history { sessionId: S1 }
```
Assert: `lines` array is non-empty, at least one line contains "Hello, Alice!", `exitCode == null`.

---

## 10. Read history with last N

```
terminal_read_history { sessionId: S1, last: 2 }
```
Assert: `lines` has at most 2 entries.

---

## 11. Close session — returns exitCode, removes from list

```
terminal_close_session { sessionId: S1 }
```
Assert: `exitCode` is a number.

```
terminal_list_sessions {}
```
Assert: `sessions` is empty.

```
terminal_get_session { sessionId: S1 }
```
Assert: error response (session no longer exists).

---

## 12. terminal_type — character-by-character

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Save as **S2**.

```
terminal_wait_for { sessionId: S2, pattern: "What is your name?" }
terminal_type { sessionId: S2, text: "Bob" }
terminal_press_key { sessionId: S2, key: "Enter" }
terminal_wait_for { sessionId: S2, pattern: "Hello, Bob!" }
```
Assert: each step succeeds, final wait matches.

```
terminal_close_session { sessionId: S2 }
```

---

## 13. terminal_wait_for with literal flag

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Save as **S3**.

```
terminal_wait_for { sessionId: S3, pattern: "What is your name?", literal: true }
```
Assert: `matched == true`. (The `?` must not be treated as a regex quantifier.)

```
terminal_fill { sessionId: S3, text: "Carol\n" }
terminal_wait_for { sessionId: S3, pattern: "Hello, Carol!", literal: true }
```
Assert: `matched == true`.

```
terminal_close_session { sessionId: S3 }
```

---

## 14. terminal_wait_for regex

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Save as **S4**.

```
terminal_wait_for { sessionId: S4, pattern: "What is your name\\?" }
```
Assert: matches (regex `\?` matches literal `?`).

```
terminal_fill { sessionId: S4, text: "Dan\n" }
terminal_wait_for { sessionId: S4, pattern: "Hello,\\s+Dan" }
```
Assert: `matched == true`.

```
terminal_close_session { sessionId: S4 }
```

---

## 15. terminal_wait_for timeout exceeded

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Save as **S5**.

```
terminal_wait_for { sessionId: S5, pattern: "THIS_WILL_NEVER_APPEAR", timeout: 500 }
```
Assert: error response (timeout).

```
terminal_close_session { sessionId: S5 }
```

---

## 16. terminal_wait_for_exit — natural exit

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Save as **S6**.

```
terminal_wait_for { sessionId: S6, pattern: "What is your name?" }
terminal_fill { sessionId: S6, text: "Eve\n" }
terminal_wait_for_exit { sessionId: S6, timeout: 5000 }
```
Assert: `exitCode == 0`.

```
terminal_get_session { sessionId: S6 }
```
Assert: `exitCode == 0` (already exited).

```
terminal_wait_for_exit { sessionId: S6 }
```
Assert: `exitCode == 0` (returns immediately when already exited).

```
terminal_close_session { sessionId: S6 }
```

---

## 17. terminal_wait_for_exit — timeout exceeded

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Save as **S7**.

```
terminal_wait_for { sessionId: S7, pattern: "What is your name?" }
terminal_wait_for_exit { sessionId: S7, timeout: 300 }
```
Assert: error response (timed out waiting for exit).

```
terminal_close_session { sessionId: S7 }
```

---

## 18. terminal_send_signal — SIGINT

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
```
Save as **S8**.

```
terminal_wait_for { sessionId: S8, pattern: "What is your name?" }
terminal_send_signal { sessionId: S8, signal: "SIGINT" }
terminal_wait_for_exit { sessionId: S8, timeout: 3000 }
```
Assert: `exitCode` is a number (typically 130).

```
terminal_read_screen { sessionId: S8 }
```
Assert: `exitCode` matches what `wait_for_exit` returned.

```
terminal_close_session { sessionId: S8 }
```

---

## 19. terminal_resize

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"], cols: 80, rows: 24 }
```
Save as **S9**.

```
terminal_read_screen { sessionId: S9 }
```
Assert: `size.cols == 80`, `size.rows == 24`.

```
terminal_resize { sessionId: S9, cols: 120, rows: 40 }
terminal_read_screen { sessionId: S9 }
```
Assert: `size.cols == 120`, `size.rows == 40`.

```
terminal_wait_for { sessionId: S9, pattern: "What is your name?" }
terminal_fill { sessionId: S9, text: "Frank\n" }
terminal_wait_for { sessionId: S9, pattern: "Hello, Frank!" }
```
Assert: interaction works after resize.

```
terminal_close_session { sessionId: S9 }
```

---

## 20. Full flow — menu-cli with ArrowDown navigation

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/menu-cli.ts"] }
```
Save as **S10**.

```
terminal_wait_for { sessionId: S10, pattern: "Select an option:" }
terminal_press_key { sessionId: S10, key: "ArrowDown" }
terminal_press_key { sessionId: S10, key: "ArrowDown" }
terminal_press_key { sessionId: S10, key: "Enter" }
terminal_wait_for { sessionId: S10, pattern: "You selected: Option 3" }
```
Assert: all steps succeed.

```
terminal_wait_for_exit { sessionId: S10, timeout: 3000 }
```
Assert: `exitCode == 0`.

```
terminal_close_session { sessionId: S10 }
```

---

## 21. Full flow — menu-cli ArrowUp wrap-around

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/menu-cli.ts"] }
```
Save as **S11**.

```
terminal_wait_for { sessionId: S11, pattern: "Select an option:" }
terminal_press_key { sessionId: S11, key: "ArrowUp" }
terminal_press_key { sessionId: S11, key: "Enter" }
terminal_wait_for { sessionId: S11, pattern: "You selected: Option" }
```
Assert: matches (ArrowUp from top wraps to last item or stays on first — verify the selection is valid).

```
terminal_close_session { sessionId: S11 }
```

---

## 22. Multiple concurrent sessions — isolation

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/test-cli.ts"] }
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/terminal-pilot/src/testing/menu-cli.ts"] }
```
Save as **SA**, **SB**, **SC**.

```
terminal_list_sessions {}
```
Assert: `sessions` has exactly 3 entries.

Drive each session independently:

```
terminal_wait_for { sessionId: SA, pattern: "What is your name?" }
terminal_fill { sessionId: SA, text: "Session-A\n" }

terminal_wait_for { sessionId: SB, pattern: "What is your name?" }
terminal_fill { sessionId: SB, text: "Session-B\n" }

terminal_wait_for { sessionId: SC, pattern: "Select an option:" }
terminal_press_key { sessionId: SC, key: "Enter" }
```

```
terminal_wait_for { sessionId: SA, pattern: "Hello, Session-A!" }
terminal_wait_for { sessionId: SB, pattern: "Hello, Session-B!" }
terminal_wait_for { sessionId: SC, pattern: "You selected: Option 1" }
```
Assert: all match — histories are isolated.

```
terminal_read_history { sessionId: SA }
```
Assert: contains "Session-A", does NOT contain "Session-B".

```
terminal_read_history { sessionId: SB }
```
Assert: contains "Session-B", does NOT contain "Session-A".

Close only SB:

```
terminal_close_session { sessionId: SB }
terminal_list_sessions {}
```
Assert: `sessions` has 2 entries (SA and SC).

```
terminal_close_session { sessionId: SA }
terminal_close_session { sessionId: SC }
```

---

## 23. Final state

```
terminal_list_sessions {}
```
Assert: `sessions` is empty.

---

## 24. Unknown session error

```
terminal_read_screen { sessionId: "does-not-exist" }
```
Assert: error response.

```
terminal_close_session { sessionId: "does-not-exist" }
```
Assert: error response.
