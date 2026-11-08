# Live harness queue: terminal-pilot walkthrough

Use the real dashboard and queue with simulated agent output. The fixture starts no agents and writes no project files. Keep captures under `out/harness-tui-live-queue`.

The eight-hour feature and design review is complete. Full `npm test` passed on committed source daaa8cfa7, including all declared workspace unit tasks and root post-test lint stress checks. Final build, guarded root lint, native-process type checks, and public SDK consumer verification passed at f018aa407, which adds the Superintendent export and documentation corrections. Terminal-pilot walkthroughs and screenshot review passed across all five harnesses. The execution notes below distinguish failed partial runs from completed checks. Delivery is local on `main`; no push or release was performed.

Review captures: [plans, tasks, messages, and Markdown](../../out/harness-tui-live-queue/final-markdown-queue-120x32.png), [narrow terminal](../../out/harness-tui-live-queue/final-markdown-queue-80x24.png), and [concise action view](../../out/harness-tui-live-queue/final-regression-120x32.png).

## Start and inspect

1. Create a 140×36 terminal-pilot session running `node_modules/.bin/tsx tests/fixtures/pipeline-tui/live-queue.mts regression`.
2. Capture a screenshot and inspect it. Confirm both plan names appear in order, the first plan is active, Setup is separate from `Read validation.ts`, and task progress is 7/30. Usage must read unavailable.
3. Confirm task 8 and subsequent tasks are visible without scrolling through tool output.

## Queue while working

1. Type `Review the public API` and press Enter. The message should appear under the first plan.
2. Type another message, `Check the final tests`, and press Enter. Confirm both messages retain insertion order.
3. Press Alt+Down to target the second plan. Queue `Summarize the TypeScript changes`. Verify it appears under the second plan.
4. Press Ctrl+P and enter `docs/plans/third.md`. Confirm the third plan is appended after the second and the active work does not change.
5. Enter `missing.md` in plan mode. The error should remain visible alongside the editable draft. Correct the text and submit again.

## Editing and layout

1. Paste a multiline message containing `q`, Unicode, and a long line. The paste must stay in the editor without submitting or quitting.
2. Move the cursor and delete a combined emoji or accented character. It should remain well formed.
   Use Up/Down to move through explicit and wrapped lines, including a shorter middle line. Return through that line and confirm the desired column is restored. Resize and repeat; input navigation must use the new displayed width without scrolling the transcript.
3. Resize to 80×24. Current and next plans and the input must remain visible.
4. Press Escape, then `v`, to inspect tasks and plans in compact mode. Press `v` again to return to output, and `i` to return to the preserved message draft.
5. Resize to 260×44. Readable line lengths and panel alignment should hold.

## Advance the sequence

Use the fixture without `regression` for its short three-task plans.

1. Press Escape, then `r` to finish setup. Confirm the first task and implement step become active.
2. Press `r` to finish implement, then again to finish verify. Confirm task completion and movement to the next task.
3. Inspect action entries with `d` to toggle details. The normal view should show short labels; expanded view exposes command details.
4. Advance all tasks and teardown. Confirm each queued message runs in order before the next plan begins.
5. Add a plan while a follow-up message is running. It should join the tail of the same sequence.
6. Confirm the final state marks completed plans and messages, with no pending work silently discarded.

## Cancellation and performance

1. With queued work pending, press Ctrl+C. Verify terminal modes are restored and no later item runs.
2. Repeat using Escape then `q`.
3. Use Ctrl+G to inspect render timing in browse mode. Type while output changes and resize while holding scrollback. Inspect p95 paint/input latency and confirm the draft and held history stay stable.
4. Close each terminal-pilot session after inspection.

For streaming stress, launch `live-queue.mts regression burst`. It refreshes a large live message every 16 ms while the normal queue and composer stay usable. Use Ctrl+G in browse mode, type and edit a draft, inspect the queue, and resize. Quit to print the measured render/input percentiles in terminal history. This fixture generates output only; inspect and record the results manually.

For action presentation, launch `live-queue.mts regression actions`. It runs real summary formatting over simulated commands. Confirm the normal view retains the explanation and two latest actions; `d` exposes the original commands. Directory-prefixed reads and searches should retain their working directory beside a short action label. Use Escape then `r` to start a task and verify its current step at 80 columns. Current terminal-pilot uses a positional screenshot path: `terminal-pilot screenshot out/capture.png --session <name>`.

For agent replies, launch `live-queue.mts regression markdown`. Inspect headings, emphasis, checkboxes, code indentation, and link destinations at 120×32 and 80×24, then repeat without color. Add `burst` to replace a long Markdown reply every 16 ms; type a draft, hold history, and resume following. Earlier paragraphs must remain reachable without a false new-message marker at the top of a continued reply.

## Agent checklists and submissions near completion

1. After the normal build, launch `live-queue.mts regression checklist` at 120×32. Confirm an Agent checklist appears separately from the 7/30 harness tasks.
2. Press Escape then `r`. The checklist should update from 0/8 to 6/8 in place, with completed markers and two pending entries. Harness counts must remain unchanged.
3. Resize to 80×24, then press `d`. Confirm all eight entries appear once. Press `d` again and `r` to complete the checklist; inspect the 8/8 state.
4. Launch `live-queue.mts validation-race`. Read the simulation PID shown in the transcript. Switch to plan input and submit `docs/plans/final-review.md`.
5. Send SIGUSR1 to that simulation PID to finish the current plan while validation remains pending. The TUI must stay open with “Adding to queue…”. Send SIGUSR2 to finish validation. The added plan must start as plan 2/2. Finish it with SIGUSR1, then quit.
6. Repeat with `missing.md`. Release validation with SIGUSR2 and inspect the editable inline error. Quit and confirm the restored terminal reports “Could not queue plan: Plan file was not found”.
7. Repeat submission with validation still pending and press Ctrl+C. Cancellation must return promptly without running a later plan. Close each session.

The signal-controlled fixture simulates delayed validation only; it does not read or modify a real plan file or execute agent commands. The underlying queue and dashboard are production code.

## Built CLI with a simulated external agent

1. Run the normal workspace build. Place an executable named `codex` in a temporary directory under `out`; it should invoke `node <repository>/tests/fixtures/pipeline-tui/manual-codex.mjs "$@"`. Prepend only that directory to the terminal-pilot session's PATH.
2. Start the actual CLI with `--yes pipeline run <temporary-plan.md> --agent codex --model simulation --tui --no-archive --after-plan "Review the API"`. Use a temporary working directory and plans under its `docs/plans` directory.
3. Confirm the agent checklist updates in place to 2/3, independently of harness task counts. Queue a second message, append a second plan, and target a multiline message at it. Edit its first line with Up before submitting.
4. Read the simulated agent PID from the transcript. Send SIGUSR1 to that PID to finish each invocation. Confirm both first-plan messages finish before plan two starts, then finish its messages. Inspect the task/plan list and final summary at 120 and 80 columns.
5. Start a fresh run with two plans and pending messages. Send SIGUSR2 to the displayed agent PID to simulate a failed command. Confirm exit 1, no follow-up execution, and the retained pending count in the final summary.
6. Repeat the success sequence with Gaslight and a temporary config containing an initial prompt and two follow-ups. The three configured rounds must finish before queued messages; an appended plan must inherit `--after-plan`. Close each session after inspecting its restored terminal.

This external-agent fixture emits representative Codex JSONL only. It does not execute the shell commands described by those events or call an LLM.

## Execution notes

- Baseline 120×36 screenshot inspected before changes.
- Production pipeline walkthrough: passed message targeting, multiple follow-ups, live plan append, full completion, inline missing-path errors at 80×24, compact queue view, and Ctrl+C terminal restoration. Captures are under out/harness-tui-live-queue/production-*.png.
- Gaslight production walkthrough: three configured rounds, two queued messages, and a second plan completed through the manually advanced fake Codex process. Unicode multiline paste and resize were checked. It exposed and fixed a stale hidden input target and incorrect final resume-thread selection.
- Ralph production walkthrough: two initial plans, two messages after the first plan, and a third plan added while running completed in order (exit 0). Both 140×36 and 80×24 screenshots were inspected; the input followed the active plan after switching modes.
- Experiment production walkthrough: an isolated fixture Git repository reproduced a later-plan failure caused by the earlier journal. The sequence now excludes every selected plan and journal from experiment Git scope. Repeated the three-plan sequence with one follow-up after each plan; all six invocations completed in order (exit 0). Inspected the 120×32 color capture and 140×36 monochrome capture.
- The inherited environment sets NO_COLOR=1. Repeat selected captures with FORCE_COLOR=1 and without it; lifecycle markers must remain legible in both.
- Full task navigation passed at 120×32 and 80×24, including the final task and parent context for a list starting mid-task. The normal sidebar now explicitly marks hidden tasks with `v View all`.
- Streaming performance at 120×32, replacing roughly 16 KB every 16 ms: the original steady-state capture ended at paint p95 5.92 ms, input p95 27.47 ms, 45 FPS. Tracking accumulated line width instead of repeatedly remeasuring it ended at paint p95 3.44 ms, input p95 21.06 ms, 50 FPS. These are local observations, not CI thresholds. Inspected performance-optimized-120x32.png; both sessions exited 0 and were closed.
- Deterministic wrapping tests bound measured text volume while retaining mixed Unicode, tabs, and combined emoji. Action-label regressions cover combined sed edit flags and sort output flags.
- Superintendent production walkthrough: two initial plans, a third appended while running, two repeated `--after-plan` messages, and one extra first-plan message completed all 16 simulated agent invocations in order (three roles per plan, seven follow-ups). Pausing after builder and resuming continued within round 1. Task Board edits refreshed after each role. Inspected 140×36 and 80×24 captures; final summary reported `3/3 plans · 7/7 messages`, exit 0. Session closed.
- The Superintendent walkthrough exposed workflow tool names emitted by Codex (`server.workflow_transition`) and a pause that consumed another round. Regressions now cover both, failed/cancelled workflow actions, external cancellation while paused, graceful stop during a follow-up, read-only multi-plan previews, and failed-follow-up worktree retention. The command returns exit 1 for a failed message and 130 for cancellation.
- Quiet action rendering and long queues: `live-queue.mts long-queue` simulates 25 follow-ups after each plan, stopped at message 18. Inspected pipeline-long-queue-120x32.png; the active message and parent plan are visible with later-work overflow. Inspected pipeline-quiet-140x36.png with the original 7/30 task state, active task and step, and subdued completed actions.
- Action folding and compact steps: inspected actions-folded-80x24.png, actions-folded-140x36.png, and actions-details-80x24.png. Original commands remain available in Details. Compact task/step/count and Quit hints fit without losing the active step.
- Gaslight follow-up preview: inspected gaslight-preview-120x26.png and the maintained screenshot-poe-code capture gaslight-help.png. Two messages appear beneath each selected plan, and both new flags are documented.
- Final Pipeline summary walk: appended an already-complete second plan during the first follow-up, confirmed its repeated messages were added, and completed five fake agent invocations. Captured pipeline-final-added-during-message-120x32.png, pipeline-final-second-plan-80x24.png, and pipeline-final-summary-80x24.png. Queue reported 2/2 plans and 4/4 messages, exit 0. The per-plan no-work line still needs clearer wording.
- The later summary wording, large-list performance, and current-work navigation reviews passed. Inspected current-work, 60-column footer, final-summary, mixed-search-action, and 250-line draft captures. The work list formats only visible rows and opens at current work.
- New checklist walkthrough passed at 120×32 and 80×24: `agent-checklist-initial-120x32.png`, `agent-checklist-updated-120x32.png`, `agent-checklist-details-80x24.png`, and `agent-checklist-complete-80x24.png` were inspected. A separate large-command capture confirmed the concise “Run shell script” action.
- The delayed validation walkthrough passed: `queue-validation-waiting-100x28.png` and `queue-validation-accepted-100x28.png` show that a submitted plan survives completion of the original work. `queue-validation-rejected-100x28.png` and `queue-rejection-after-exit-100x28.png` show visible rejection before and after exit. Timing counters from these captures were collected while the full test suite loaded the machine and are not performance baselines.
- Running-action timers, delayed message acceptance, and per-plan follow-up position passed visual inspection in action-age-live-100x28.png, message-ack-final-100x28.png, and followup-position-80x24.png.
- Vertical navigation passed after reproducing an unchanged caret on Up. Inspected multiline-up-before-100x28.png, multiline-up-after-100x28.png, and wrapped-draft-up-80x24.png. The edited middle paragraph queued successfully; a later long line remained editable after resizing.
- Local grapheme navigation passed with 250 pasted Unicode lines: Backspace removed a complete combined accent, then Delete removed a whole joined emoji. Inspected unicode-local-edit-100x28.png and unicode-local-delete-80x24.png; terminal screen text confirmed the retained Unicode even where the screenshot font used missing-glyph boxes. Both sessions restored the terminal and exited 0.
- The first isolated full run found two missing historical SafeJS fixture imports. Existing repository commits moved those unchanged fixtures beside their tests; the two affected suites passed all 36 tests after applying those repairs locally. A final full rerun is still required.
- The rebuilt Pipeline CLI completed two plans and four messages, including a multiline message edited with Up. Its final summary reported `2/2 plans · 4/4 messages`, exit 0. Inspected final-cli-checklist-140x36.png, final-cli-queued-140x36.png, final-cli-followup-80x24.png, final-cli-second-plan-list-80x24.png, and final-cli-summary-120x32.png. A separate simulated failed command exited 1 with `0/2 plans · 0/2 messages · 3 pending`; inspected final-cli-failure-summary-100x28.png.
- The rebuilt Gaslight CLI completed two plans, six configured rounds, and three messages in order, exit 0. Inspected final-gaslight-checklist-120x32.png, final-gaslight-followup-80x24.png, final-gaslight-plan-order-80x24.png, and final-gaslight-summary-80x24.png. The resume command retained the second plan's conversation after its message completed.
- Final 30-task regression captures passed at 260×44, 120×32, and 80×24. Task 8, its implement step, 7/30 progress, three plans, and three targeted messages remained explicit. Details exposed the original commands; the full work list opened around the active step. Inspected final-regression-*.png and closed the session with terminal restoration.
- Additional review passed multiline editing during continuous output and directory-aware action labels. Inspected final-stream-edit-100x28.png, final-stream-queued-80x24.png, and directory-actions-*.png. Agent-spawn passed all 666 tests.
- Markdown replies passed color and monochrome inspection, including headings, checkboxes, code blocks, links, held history, and input during streaming. Inspected markdown-after-120x32.png, markdown-after-80x24.png, markdown-heading-80x24.png, markdown-no-color-100x30.png, and both markdown-*-stream-edit-120x32.png captures. All 1,944 design tests passed. Tests compare partial rendering with the complete Markdown renderer, including footnotes, and cover malformed streamed frontmatter.
- A local large-reply measurement exposed excessive full-document formatting. Formatting visible blocks reduced its median from about 15.5 ms to 3.7 ms; cached unchanged replies took about 0.14 ms. These measurements and the latest PTY timing overlays were collected during repository test load and are not CI thresholds.
- The sustained streaming session processed more than 60,000 updates over roughly 24 minutes, including held history, resize, and a queued message. Observed RSS samples varied rather than growing continuously. Inspected sustained-stream-queued-80x24.png; the session restored the terminal and exited 0.
- An archived-plan regression showed fresh Pipeline and Ralph follow-ups referenced the removed original path. Follow-ups now use the actual archived path while result and queue identities retain the submitted name. All 624 affected package tests passed. The rebuilt CLI then completed both archive-enabled sequences with `1/1 plans · 1/1 messages`, exit 0. The fake agent printed the actual archived path, and each file existed there. Inspected archive-context-pipeline-final-120x32.png, archive-context-ralph-80x26.png, and both archive-context-*-summary captures; all sessions were closed.
- The next full run passed shared, Op, Python, and shell stages, then reproduced a 5-second camera-fixture timeout in SafeJS. Its two-sample batches were reduced to one sample without dropping any comparison; the focused file passed all 18 tests. The already-failed full run was stopped and requires a final rerun at the completed source state.
- Worktree review reproduced follow-up prompts naming the original absolute plan path after the host mapped execution into a worktree. Pipeline, Ralph, and Experiment now use the completed plan's execution path while preserving its submitted queue identity. All 534 affected package tests passed. The final normal build then passed, followed by all eight SDK sequence tests, including initial and appended absolute plan paths in a worktree.
- The combined Markdown and queue view passed final inspection at 120×32 and 80×24. Both targeted messages, task 8's implement step, 7/30 progress, link destinations, code indentation, and the selected input target remained clear. Inspected final-markdown-queue-120x32.png and final-markdown-queue-80x24.png; the session exited 0 and was closed. Design documentation regenerated successfully without tracked changes.
- The next broad run passed 116,153 shared tests and all shell stages, then reported one 5-second timeout in the 1,027-case independent regex file. The unchanged complete file passed on focused rerun, and the camera repair passed during the broad run. No regex implementation or timeout was changed without a reproducible cause. The already-failed run was stopped and full clean-checkout verification restarted at final product commit 15233e3cd.
- The final normal build, SDK checks, repository lint, focused lint for the later path correction, and design documentation generation have passed. The eight-hour feature/design review completed at 12:04:36 UTC. Remaining: finish the clean-checkout full test and final cleanup. Delivery remains local; no push or release has been performed.
- The final-product rerun passed 116,156 shared tests, Op, Python, and the shell-runner stage, then reproduced a shell test's 200 ms process-startup race (`consumed` had not arrived before the deadline). Commit daaa8cfa7 waits for consumer output, then advances the same deadline with a controlled clock. All 40 process-harness tests and focused lint passed. The full command exited 1 and did not reach SafeJS; a fresh full run now includes this repair. These partial runs are not recorded as completed gates.
- Native-process repair provenance: the failed full run used committed source 15233e3cd on Node v22.23.2, Darwin arm64. Its shell stage had 32,368 passes, one failure, and 86 skips; the native readiness case ended after 203.025458 ms with empty stderr instead of `consumed`. The mutable test file's Git blob changed from 58b399cbf1687ba8488f6ef95b980a0bf09060dc to 14d1b4c2b43f0438b49f49fa5f144bdb4eedaf88 in daaa8cfa7. The native script, output assertions, and 200 ms deadline remain; startup synchronization now precedes explicit clock advancement. Historical captured data was not rewritten, and this test-only correction makes no product performance claim.
- The public SDK audit reproduced `runSuperintendentSequence is not a function` when imported from the root entrypoint. Commit 8931728e6 adds the missing value and option/result type exports. The new consumer test invokes that export with memfs and a fake builder, queues two messages, and appends a second plan. Both follow-ups execute before the appended plan with the configured builder agent, mode, and directory. All 357 selected entrypoint/SDK tests passed; final build and packaged-entrypoint verification remain pending after the broad run.
- Full verification completed successfully at 13:08 UTC on committed source daaa8cfa7: `npm test` exited 0. The maintained uncached runner derived 73 workspaces, 21 build tasks, and 42 unit tasks from repository declarations, with no exclusions; workspaces without a declared unit task were reported separately, not counted as passes. Shared tests passed 116,156 cases; shell passed 32,369 with 86 skips; SafeJS passed 30,556 with 48 skips, including the regex and camera suites; Safe Python passed 83,807. Terminal-pilot passed 293, followed by both root post-test lint stress checks. These are separate stage counts, not a deduplicated total. The subsequent changes are the public Superintendent export and documentation; their focused verification is recorded separately.
- Final committed-source checks at f018aa407 passed: normal `npm run build`; all 332 selected entrypoint/SDK sequence tests; `npm run typecheck --workspace=virtual-bash`, including its 26 current consumer groups and expected negative diagnostics; and complete root `npm run lint` through guarded ESLint, TypeScript contracts, and workflow lint. A separate consumer imported from `poe-code`, resolving to the generated `dist/index.js`, and completed two plans with two intervening messages using the configured builder. Generated root declarations expose the sequence option/result types through the packaged Superintendent declarations. No tests queried an LLM during these feature and consumer checks.
- Cleanup: removed the task's temporary validation worktree and disposable logs/measurements after recording their results and failure provenance. Review PNGs remain under `out/harness-tui-live-queue`. Other worktrees and unrelated user changes were preserved.
