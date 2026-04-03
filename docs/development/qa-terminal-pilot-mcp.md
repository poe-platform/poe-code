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

---

## 25. Bash — interactive shell

```
terminal_create_session { command: "bash", args: ["--norc", "--noprofile"], cols: 120, rows: 40 }
```
Save as **BASH**.

```
terminal_wait_for { sessionId: BASH, pattern: "\\$\\s*$", timeout: 3000 }
```
Assert: shell prompt visible.

```
terminal_fill { sessionId: BASH, text: "echo hello-from-bash\n" }
terminal_wait_for { sessionId: BASH, pattern: "hello-from-bash" }
```
Assert: output appears.

```
terminal_fill { sessionId: BASH, text: "echo $((6 * 7))\n" }
terminal_wait_for { sessionId: BASH, pattern: "42" }
```
Assert: arithmetic works.

```
terminal_fill { sessionId: BASH, text: "sleep 60\n" }
terminal_wait_for { sessionId: BASH, pattern: "sleep", timeout: 2000 }
terminal_press_key { sessionId: BASH, key: "Control+c" }
terminal_wait_for { sessionId: BASH, pattern: "\\$\\s*$", timeout: 3000 }
```
Assert: Control+C interrupts the sleep and returns to prompt.

```
terminal_fill { sessionId: BASH, text: "exit\n" }
terminal_wait_for_exit { sessionId: BASH, timeout: 3000 }
```
Assert: `exitCode == 0`.

```
terminal_close_session { sessionId: BASH }
```

---

## 26. Bash — long output, read_history line count

```
terminal_create_session { command: "bash", args: ["--norc", "--noprofile"] }
```
Save as **BASH2**.

```
terminal_wait_for { sessionId: BASH2, pattern: "\\$\\s*$", timeout: 3000 }
terminal_fill { sessionId: BASH2, text: "for i in $(seq 1 50); do echo \"line $i\"; done\n" }
terminal_wait_for { sessionId: BASH2, pattern: "line 50" }
```

```
terminal_read_history { sessionId: BASH2 }
```
Assert: `lines` contains entries for "line 1" through "line 50".

```
terminal_read_history { sessionId: BASH2, last: 10 }
```
Assert: `lines` has at most 10 entries, last entry contains "line 50".

```
terminal_close_session { sessionId: BASH2 }
```

---

## 27. Python REPL — expression evaluation and multi-line input

```
terminal_create_session { command: "python3", args: ["-q"], cols: 120, rows: 40 }
```
Save as **PY**.

```
terminal_wait_for { sessionId: PY, pattern: ">>>" }
```

```
terminal_fill { sessionId: PY, text: "2 ** 10\n" }
terminal_wait_for { sessionId: PY, pattern: "1024" }
```
Assert: `1024` appears.

```
terminal_fill { sessionId: PY, text: "[x*x for x in range(5)]\n" }
terminal_wait_for { sessionId: PY, pattern: "\\[0, 1, 4, 9, 16\\]" }
```
Assert: list comprehension result appears.

Multi-line function definition:
```
terminal_fill { sessionId: PY, text: "def greet(name):\n" }
terminal_wait_for { sessionId: PY, pattern: "\\.\\.\\." }
terminal_fill { sessionId: PY, text: "    return f'hi {name}'\n" }
terminal_wait_for { sessionId: PY, pattern: "\\.\\.\\." }
terminal_fill { sessionId: PY, text: "\n" }
terminal_wait_for { sessionId: PY, pattern: ">>>" }
terminal_fill { sessionId: PY, text: "greet('world')\n" }
terminal_wait_for { sessionId: PY, pattern: "hi world" }
```
Assert: function defined and called successfully.

```
terminal_press_key { sessionId: PY, key: "Control+d" }
terminal_wait_for_exit { sessionId: PY, timeout: 3000 }
```
Assert: `exitCode == 0`.

```
terminal_close_session { sessionId: PY }
```

---

## 28. Node.js REPL — evaluation and tab completion

```
terminal_create_session { command: "node", cols: 120, rows: 40 }
```
Save as **NODE**.

```
terminal_wait_for { sessionId: NODE, pattern: ">" }
```

```
terminal_fill { sessionId: NODE, text: "Math.PI.toFixed(4)\n" }
terminal_wait_for { sessionId: NODE, pattern: "3.1416" }
```

```
terminal_fill { sessionId: NODE, text: "[1,2,3].map(x => x * 2)\n" }
terminal_wait_for { sessionId: NODE, pattern: "\\[ 2, 4, 6 \\]" }
```

```
terminal_fill { sessionId: NODE, text: "process.version\n" }
terminal_wait_for { sessionId: NODE, pattern: "v\\d+" }
```
Assert: Node.js version string appears.

```
terminal_press_key { sessionId: NODE, key: "Control+d" }
terminal_wait_for_exit { sessionId: NODE, timeout: 3000 }
terminal_close_session { sessionId: NODE }
```

---

## 29. vim — open, insert, edit, save and quit

```
terminal_create_session { command: "vim", args: ["/tmp/terminal-pilot-qa-test.txt"], cols: 120, rows: 40 }
```
Save as **VIM**.

```
terminal_wait_for { sessionId: VIM, pattern: "terminal-pilot-qa-test.txt", timeout: 5000 }
```
Assert: vim opens and shows the filename.

Enter insert mode and type:
```
terminal_press_key { sessionId: VIM, key: "i" }
terminal_type { sessionId: VIM, text: "hello from terminal-pilot" }
```

Exit insert mode:
```
terminal_press_key { sessionId: VIM, key: "Escape" }
```

```
terminal_read_screen { sessionId: VIM }
```
Assert: `lines` contains "hello from terminal-pilot". `exitCode == null`.

Save and quit:
```
terminal_fill { sessionId: VIM, text: ":wq\n" }
terminal_wait_for_exit { sessionId: VIM, timeout: 5000 }
```
Assert: `exitCode == 0`.

```
terminal_close_session { sessionId: VIM }
```

Verify the file was written:
```
terminal_create_session { command: "cat", args: ["/tmp/terminal-pilot-qa-test.txt"] }
```
Save as **CAT**.
```
terminal_wait_for { sessionId: CAT, pattern: "hello from terminal-pilot" }
terminal_close_session { sessionId: CAT }
```

---

## 30. vim — quit without saving (discard)

```
terminal_create_session { command: "vim", args: ["/tmp/terminal-pilot-qa-discard.txt"], cols: 80, rows: 24 }
```
Save as **VIM2**.

```
terminal_wait_for { sessionId: VIM2, pattern: "terminal-pilot-qa-discard.txt", timeout: 5000 }
terminal_press_key { sessionId: VIM2, key: "i" }
terminal_type { sessionId: VIM2, text: "this should not be saved" }
terminal_press_key { sessionId: VIM2, key: "Escape" }
terminal_fill { sessionId: VIM2, text: ":q!\n" }
terminal_wait_for_exit { sessionId: VIM2, timeout: 5000 }
```
Assert: `exitCode == 0` (forced quit succeeds).

```
terminal_close_session { sessionId: VIM2 }
```

---

## 31. poe-code — help output

```
terminal_create_session { command: "node_modules/.bin/tsx", args: ["packages/poe-code/src/cli.ts", "--help"], cols: 120, rows: 40 }
```
Save as **POE_HELP**.

```
terminal_wait_for { sessionId: POE_HELP, pattern: "Usage:", timeout: 10000 }
terminal_read_screen { sessionId: POE_HELP }
```
Assert: screen contains "configure" command.

```
terminal_wait_for_exit { sessionId: POE_HELP, timeout: 5000 }
terminal_close_session { sessionId: POE_HELP }
```

---

## 32. poe-code configure — interactive agent selection

Create a temporary home directory first by running a bash one-liner to get the path:

```
terminal_create_session { command: "bash", args: ["-c", "mktemp -d /tmp/poe-qa-XXXXXX && echo TMPDIR_READY"] }
```
Save as **MKTMP**. Wait for "TMPDIR_READY", read the line before it to get the path (e.g. `/tmp/poe-qa-abc123`). Save as **TMPDIR**. Close **MKTMP**.

Start configure with isolated home:
```
terminal_create_session {
  command: "bash",
  args: ["-c", "HOME=TMPDIR XDG_CONFIG_HOME=TMPDIR/.config XDG_DATA_HOME=TMPDIR/.local/share node_modules/.bin/tsx packages/poe-code/src/cli.ts configure"],
  cols: 120,
  rows: 40
}
```
(Substitute the actual TMPDIR path into the command string.) Save as **CONF**.

```
terminal_wait_for { sessionId: CONF, pattern: "Pick an agent to configure", timeout: 15000 }
```
Assert: agent picker appears.

```
terminal_read_screen { sessionId: CONF }
```
Assert: screen lists available agents (Claude, Gemini, etc.), cursor is visible.

Navigate to a different agent:
```
terminal_press_key { sessionId: CONF, key: "ArrowDown" }
terminal_read_screen { sessionId: CONF }
```
Assert: selection moved down.

Navigate back:
```
terminal_press_key { sessionId: CONF, key: "ArrowUp" }
```

Select the first agent (Claude) with Enter:
```
terminal_press_key { sessionId: CONF, key: "Enter" }
terminal_wait_for { sessionId: CONF, pattern: "model|API key|authorization|Waiting", timeout: 15000 }
```
Assert: moved to the next step (model selection or auth).

```
terminal_read_screen { sessionId: CONF }
```
Assert: screen shows the next configuration step.

Interrupt the configure flow:
```
terminal_press_key { sessionId: CONF, key: "Control+c" }
terminal_wait_for_exit { sessionId: CONF, timeout: 5000 }
terminal_close_session { sessionId: CONF }
```

Clean up temp dir:
```
terminal_create_session { command: "rm", args: ["-rf", "TMPDIR"] }
terminal_wait_for_exit { sessionId: cleanup, timeout: 3000 }
terminal_close_session { sessionId: cleanup }
```

---

## 33. Claude Code — version and help

```
terminal_create_session { command: "claude", args: ["--version"], cols: 120, rows: 40 }
```
Save as **CC_VER**.

```
terminal_wait_for { sessionId: CC_VER, pattern: "\\d+\\.\\d+\\.\\d+", timeout: 10000 }
```
Assert: a semver string appears.

```
terminal_wait_for_exit { sessionId: CC_VER, timeout: 5000 }
terminal_close_session { sessionId: CC_VER }
```

```
terminal_create_session { command: "claude", args: ["--help"], cols: 120, rows: 40 }
```
Save as **CC_HELP**.

```
terminal_wait_for { sessionId: CC_HELP, pattern: "Usage", timeout: 10000 }
terminal_read_screen { sessionId: CC_HELP }
```
Assert: help text visible, mentions common flags/commands.

```
terminal_wait_for_exit { sessionId: CC_HELP, timeout: 5000 }
terminal_close_session { sessionId: CC_HELP }
```

---

## 34. Claude Code — interactive session, single prompt

Start Claude Code in print mode (non-interactive) to avoid needing stdin:

```
terminal_create_session {
  command: "claude",
  args: ["-p", "Reply with exactly: TERMINAL_PILOT_QA_OK"],
  cols: 120,
  rows: 40
}
```
Save as **CC_PRINT**.

```
terminal_wait_for { sessionId: CC_PRINT, pattern: "TERMINAL_PILOT_QA_OK", timeout: 60000 }
```
Assert: Claude responds with the expected string.

```
terminal_read_history { sessionId: CC_PRINT }
```
Assert: history contains "TERMINAL_PILOT_QA_OK".

```
terminal_wait_for_exit { sessionId: CC_PRINT, timeout: 10000 }
```
Assert: `exitCode == 0`.

```
terminal_close_session { sessionId: CC_PRINT }
```

---

## 35. Claude Code — interactive REPL mode

```
terminal_create_session {
  command: "claude",
  cols: 120,
  rows: 40
}
```
Save as **CC_REPL**.

```
terminal_wait_for { sessionId: CC_REPL, pattern: ">|\\$|claude", timeout: 15000 }
```
Assert: interactive prompt appears.

```
terminal_read_screen { sessionId: CC_REPL }
```
Assert: screen is non-empty, `exitCode == null`.

Type a short prompt:
```
terminal_type { sessionId: CC_REPL, text: "Reply with exactly: REPL_QA_OK" }
terminal_press_key { sessionId: CC_REPL, key: "Enter" }
terminal_wait_for { sessionId: CC_REPL, pattern: "REPL_QA_OK", timeout: 60000 }
```
Assert: response contains "REPL_QA_OK".

```
terminal_read_history { sessionId: CC_REPL }
```
Assert: contains the prompt and the response.

Exit Claude Code:
```
terminal_press_key { sessionId: CC_REPL, key: "Control+c" }
```
Or type `/exit` if prompted.
```
terminal_wait_for_exit { sessionId: CC_REPL, timeout: 10000 }
terminal_close_session { sessionId: CC_REPL }
```

---

## 36. Final state — all sessions closed

```
terminal_list_sessions {}
```
Assert: `sessions` is empty.
