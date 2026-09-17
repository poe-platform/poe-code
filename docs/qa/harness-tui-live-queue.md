# Live harness queue: terminal-pilot walkthrough

Use the real dashboard and queue with simulated agent output. The fixture starts no agents and writes no project files. Keep captures under `out/harness-tui-live-queue`.

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

For action presentation, launch `live-queue.mts regression actions`. It runs real summary formatting over simulated commands and adds thirteen completed actions. Confirm the normal view retains the explanation and two latest actions; `d` exposes the original commands. Use Escape then `r` to start a task and verify its current step at 80 columns. Current terminal-pilot uses a positional screenshot path: `terminal-pilot screenshot out/capture.png --session <name>`.

## Agent checklists and submissions near completion

1. After the normal build, launch `live-queue.mts regression checklist` at 120×32. Confirm an Agent checklist appears separately from the 7/30 harness tasks.
2. Press Escape then `r`. The checklist should update from 0/8 to 6/8 in place, with completed markers and two pending entries. Harness counts must remain unchanged.
3. Resize to 80×24, then press `d`. Confirm all eight entries appear once. Press `d` again and `r` to complete the checklist; inspect the 8/8 state.
4. Launch `live-queue.mts validation-race`. Read the simulation PID shown in the transcript. Switch to plan input and submit `docs/plans/final-review.md`.
5. Send SIGUSR1 to that simulation PID to finish the current plan while validation remains pending. The TUI must stay open with “Adding to queue…”. Send SIGUSR2 to finish validation. The added plan must start as plan 2/2. Finish it with SIGUSR1, then quit.
6. Repeat with `missing.md`. Release validation with SIGUSR2 and inspect the editable inline error. Quit and confirm the restored terminal reports “Could not queue plan: Plan file was not found”.
7. Repeat submission with validation still pending and press Ctrl+C. Cancellation must return promptly without running a later plan. Close each session.

The signal-controlled fixture simulates delayed validation only; it does not read or modify a real plan file or execute agent commands. The underlying queue and dashboard are production code.

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
- Remaining: finish the clean-checkout full test, rebuild current exports, run final maintained checks and design-doc generation, finish the eight-hour visual review, and record local delivery separately from any future push/release.
