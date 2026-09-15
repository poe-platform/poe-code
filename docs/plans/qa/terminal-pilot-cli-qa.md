# Terminal-pilot CLI QA

An agent executes this procedure and records observed results; it is not a program or a unit task. It replaces the former `qa:cli` runner and preserves its 36 case identifiers. Cases 31–35 previously had no implementation and were skipped; keep their dependency status explicit rather than counting them as passes.

Build with `npm run build:workspaces -- --workspace=terminal-pilot`. Use `node packages/terminal-pilot/dist/cli.js` as the CLI, with JSON output for inspecting responses. Child programs are absolute paths to Node plus `packages/terminal-pilot/src/testing/test-cli.js` or `menu-cli.js`; resolve paths against the repository before starting. The greeting fixture exits after printing its greeting, so screen/history exit codes may transition from null to zero.

Set `TERMINAL_PILOT_RUNTIME_DIR` to a fresh directory under `/private/tmp` in the QA command environment. All invocations in this run must use that same directory. This isolates the daemon and sessions from other work. Only close sessions created for this run. Record failures with command, response, screen, and process status; record unavailable optional programs separately. Use screenshots of prompts, menus, resized screens, and editor/REPL flows, and inspect the images rather than only producing files.

Capture images with `screenshot <png-path> -s <session>`; the destination is positional because `--output` controls response formatting. Commands below name the CLI subcommand and arguments. Session names are local to the isolated runtime. Use `fill` with a literal newline to submit a line, or `type` followed by `press-key Enter`. Child arguments after `--` belong to the child program. `wait-for --literal=true` matches literal text; without `--literal=true`, it accepts a pattern. Timeout values are milliseconds.

## Greeting and session lifecycle

1. **Empty session list.** Run `list-sessions` in the fresh runtime. Expect an empty sessions array.
2. **Create a session.** Run `create-session -s S1 <node> <test-cli.js>`. Expect session S1 and a positive PID.
3. **Session appears in list.** Before supplying input, list sessions. Expect only S1.
4. **Get session metadata.** Run `get-session -s S1`. Expect matching name, positive PID, the selected Node command, and null exit code.
5. **Wait for prompt.** Run `wait-for -s S1 --literal=true 'What is your name?'`. Expect matched=true and the prompt line. Capture and inspect the prompt screen.
6. **Fill text.** Fill S1 with `Alice` plus newline. Expect ok=true.
7. **Wait for greeting.** Wait literally for `Hello, Alice!`. Expect matched=true.
8. **Read screen and exit status.** Read S1's screen. Expect a lines array, numeric cursor row/column and size rows/cols, and null or zero exit code.
9. **Read history and exit status.** Read S1 history. Expect the greeting and nonempty lines, with null or zero exit code.
10. **Read history with last N.** Run `read-history -s S1 -n 2`. Expect at most two lines.
11. **Close session.** Close S1. Expect a numeric exit code, an empty session list, and a not-found error when querying S1 again.
12. **Character-by-character typing.** Create S2 with the greeting fixture, wait for its prompt, type `Bob`, press Enter, and wait for `Hello, Bob!`. Close S2.
13. **Literal waiting.** Create S3, wait with `--literal=true` for the question mark in the prompt, fill `Carol` plus newline, and wait literally for `Hello, Carol!`. Close S3.
14. **Pattern waiting.** Create S4, wait with pattern `What is your name\?`, fill `Dan` plus newline, and wait with pattern `Hello,\s+Dan`. Close S4.
15. **Wait timeout.** Create S5 and run `wait-for -s S5 -t 500 THIS_WILL_NEVER_APPEAR`. Expect a timed-out-waiting-for-pattern error. Close S5.
16. **Natural exit.** Create S6, greet Eve, and run `wait-for-exit -s S6 -t 5000`. Expect zero. Query metadata and wait for exit again; both must report zero. Close S6.
17. **Exit timeout.** Create S7 and leave it at its input prompt. Run `wait-for-exit -s S7 -t 300`. Expect a timed-out-waiting-for-process error. Close S7.
18. **SIGINT.** Create S8, wait for its prompt, send SIGINT, and wait for exit within 3000ms. Expect a numeric code matching read-screen's exit code. Close S8.
19. **Resize.** Create S9 at 80x24. Read size, resize to 120x40, and read size again. Expect exact dimensions. Capture both sizes. Greet Frank and verify the greeting, then close S9.

## Menu and isolation

20. **ArrowDown navigation.** Create S10 with the menu fixture. Wait for `Select an option:`, press ArrowDown twice, and inspect a screenshot showing Option 3 selected. Press Enter, wait for `You selected: Option 3`, and expect exit zero within 3000ms. Close S10.
21. **ArrowUp wrap-around.** Create S11 with the menu fixture. Press ArrowUp from the first option and inspect the selected last option. Press Enter and expect `You selected: Option 3`. Close S11. This makes the former broad Option [123] check verify actual wrap-around.
22. **Concurrent-session isolation.** Create SA and SB with greeting fixtures and SC with the menu. Expect three listed sessions. Greet Session-A in SA and Session-B in SB; select Option 1 in SC. Verify each output. SA history must contain Session-A and exclude Session-B; SB must contain Session-B and exclude Session-A. Close SB and verify it is absent without assuming the naturally exited sessions remain listed. Close SA and SC.
23. **Final state.** List sessions after the lifecycle/menu flows. Expect an empty array.
24. **Unknown session errors.** Read screen and close `does-not-exist`. Both must report not found.

## Real local programs

25. **Bash interaction.** Create BASH at 120x40 with `bash --norc --noprofile`. Wait for its prompt; submit `echo hello-from-bash` and `echo $((6 * 7))`, verifying output and 42. Start `sleep 60`, press Control+c, and verify prompt recovery. Capture the recovered screen. Submit `exit 0`, verify zero within 3000ms, and close BASH.
26. **Long Bash history.** Create BASH2 with the same clean Bash. Print lines 1–50 using a shell loop. Wait for line 50. Verify every numbered line is in history, and `read-history -n 10` returns at most ten lines including line 50. Close BASH2.
27. **Python REPL.** If python3 exists, create PY at 120x40 with `python3 -q`. Verify `2 ** 10` returns 1024 and `[x*x for x in range(5)]` returns [0, 1, 4, 9, 16]. Define `greet(name)` across separate inputs with an indented `return f'hi {name}'`, submit a blank line, and verify `greet('world')` returns hi world. Capture the screen. Press Control+d, expect zero within 3000ms, and close PY. Record unavailable when Python is absent.
28. **Node REPL.** Create NODE at 120x40 with Node. Verify `Math.PI.toFixed(4)` returns 3.1416, `[1,2,3].map(x => x * 2)` returns [2, 4, 6], and `process.version` returns a version. Capture the screen. Press Control+d, expect zero within 3000ms, and close NODE.
29. **Vim save.** If Vim exists, choose a fresh scratch filename in the QA directory and open VIM at 120x40. Wait for its filename, press i, type `hello from terminal-pilot`, and press Escape. Read and capture the screen; verify text and null exit code. Submit `:wq`, expect zero within 5000ms, and create CAT to read the scratch file. Verify saved text. Close VIM/CAT and remove only that scratch file.
30. **Vim discard.** Open another fresh scratch filename in VIM2 at 80x24. Enter insert mode, type `this should not be saved`, press Escape, and submit `:q!`. Expect zero within 5000ms and verify no scratch file was saved. Close VIM2. Record unavailable when Vim is absent.

## Optional external scenarios and cleanup

31. **poe-code help output.** Previously skipped. When the source CLI's build dependencies are ready, launch `poe-code --help`, inspect a screenshot for readable usage, and verify normal exit. Record execution status explicitly.
32. **poe-code configure agent selection.** Previously skipped. Use an isolated project/home with fake integrations. Launch interactive configure, inspect agent selection, navigate it, then cancel and verify restoration. Avoid modifying the user's actual agent configuration.
33. **Claude Code version/help.** Previously skipped. If a suitable local executable is available, verify version/help without querying a model, capture the help screen, and close its sessions. Otherwise record unavailable.
34. **Claude Code single prompt.** Previously skipped. Use a fake executable/protocol fixture for deterministic output; do not use an actual LLM as a test dependency. Verify live prompt result, exit, and cleanup. Until a suitable fake exists, record pending rather than passed.
35. **Claude Code interactive REPL.** Previously skipped. Use a deterministic fake interactive executable, inspect the prompt, submit input, verify output and termination. Until the fixture exists, record pending rather than passed.
36. **All sessions closed.** List sessions and expect empty. Verify no child owned by this QA run remains. Remove only this run's scratch artifacts after inspection; retain result evidence as needed. Do not close unrelated sessions or remove another run's daemon directory.


## Conversion verification

The maintained terminal-pilot package suite passed after removing the QA runner. Agent executed the isolated empty list/create/metadata, greeting/history/natural-exit/close, literal-wait, menu wrap-around, screenshot, and final-empty-list flows. Prompt and menu images were inspected. This is selected execution evidence, not a claim that every optional/local-program case above was executed. The initial old literal/screenshot spellings failed; the procedure uses the verified literal boolean and positional screenshot path.
