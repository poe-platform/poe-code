# Pipeline plan queue and persisted progress

## Changes

- Keep the active plan and selected plans in execution order above the scrolling log.
- Widen the pipeline metrics pane from 32 to 44 columns; use the existing compact layout when both panes cannot fit.
- Show completed tasks over total tasks, initialized from persisted plan statuses and refreshed from the plan before each task.
- Report the active task's position in the full plan on restart.
- Prioritize progress over secondary metrics when the queue and short terminal reduce sidebar space.

## Validation rounds

1. Regression tests reproduce session-only counters and missing fractions in wide and compact stats.
2. In-memory 90-task simulation starts with 68 saved completions, completes task 69, and starts a fresh runner with 69 saved completions on task 70.
3. Real terminal simulations cover resumed, queued, failed, burst, and Unicode output at 120x28, 100x24, 80x16, 50x16, and 100x8. Inspect settled screenshots. First round exposed missing progress in two-row sidebars; regression added and fixed.
4. Repeat terminal scenarios after adjustments. Use PageUp while output streams; plan context and progress must remain fixed, and F must restore following. Quit must restore the terminal.
5. Actual CLI with the maintained external fake Codex fixture: use an isolated temporary workspace with a 90-task plan (68 done) and a second selected plan. Cancel, restart and complete one task, then restart again. Verify 68/90, task 69/90, ordered queue, then 69/90 and task 70/90. Verify saved statuses and exit codes.
6. Run focused regression tests, maintained build closure, repository test/lint routes, and regenerate design docs. No publishing requested.

## Evidence

- Initial focused suite: 590 passing tests.
- After the restart task-position fix: 591 passing tests.
- First simulation round captured 25 screenshots under `/tmp/pipeline-round-*`.
- Actual CLI initially exercised stale built pipeline code; rebuild the maintained pipeline closure before the final actual-CLI round.

## Final verification so far

- Actual CLI cancellation/restart: exits 130, 0, 130; saved completion totals 68, 69, 69. Last restart displays task 70/90 and 69/90 completed with the second plan queued.
- Repeated five terminal scenarios at seven sizes, including 50x6 and 20x6; held screens remained unchanged during streaming, and q exits returned zero.
- Fixed compact summary/footer overlap at tiny sizes and preserved progress in one-row summaries.
- Preserved a meaningful filename in single-row plan context rather than displaying only the plan sequence label.
- Design documentation generation completed successfully without tracked output changes.
