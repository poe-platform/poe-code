# Pipeline TUI improvements

## Objective

Improve the pipeline TUI through varied fake scenarios, real terminal-pilot interaction and screenshots, measured performance improvements, and regression coverage. Work remains active; the first optimization does not complete this objective.

## Current evidence (2026-09-14)

- Pipeline uses the shared toolcraft-design dashboard in `src/cli/commands/pipeline.ts`.
- Output and stats updates synchronously repaint the dashboard. Output rendering previously wrapped every retained item before selecting the viewport.
- A failing regression test proved that hidden history was parsed even when the newest item filled the viewport. Rendering now walks backwards and stops once enough rows are available. All 140 dashboard tests passed after the change.
- Real terminal-pilot fake run: 200 tool messages, task 2/8, 31,000 tokens, long current action; tested at 100x24 and resized to 50x16. Quit exited successfully (code 0).
- ArrowUp left the screen unchanged. Pipeline advertises Scroll and Follow, but dashboard command types and defaults have no matching commands. This is validated missing functionality.
- At 100 columns the current action is silently clipped, and task/stage context scrolls out with logs. Metrics take up a large mostly empty sidebar.
- Screenshots captured in `/tmp/pipeline-dashboard-baseline.png` and `/tmp/pipeline-dashboard-narrow.png`. Narrow screenshot was captured before resize output settled: it is not sufficient evidence for responsive layout correctness. Re-run with explicit screen expectations.

## Remaining work

1. Measure viewport optimization with realistic and pathological retained history.
2. Implement actual scrolling and follow behavior with TDD, including new output while scrolled, retention limits, page navigation, and resize.
3. Coalesce high-frequency renders and avoid redundant work on stats-only updates. Validate timing, shutdown, resize, and terminal restoration.
4. Improve persistent pipeline context and current-action layout, including narrow terminals and long Unicode labels.
5. Create repeatable fake scenario fixtures covering startup, streaming, noisy tools, multiline ANSI/Unicode, failure, cancellation, empty/completed plans, task progression, limits, and large output. Fixtures drive fake execution; QA remains a Markdown plan executed by the agent.
6. Execute terminal-pilot QA with settled-screen screenshots at wide, normal, narrow, and short sizes. Verify advertised controls, cancellation, restoration, and final outcomes.
7. Run maintained scope checks, design docs generation for visual-language changes, and relevant pipeline integration tests. Commit atomic improvements with specific paths. Push only if requested; monitor any requested push through successful release.

## Ad hoc reproduction

Temporary fake run and pilot driver currently live at `/tmp/pipeline-dashboard-scenario.mts` and `/tmp/pipeline-dashboard-pilot.mts`. Run the driver with `node_modules/.bin/tsx /tmp/pipeline-dashboard-pilot.mts`. Local PTY/IPC access required execution outside the sandbox. Replace these temporary sources with maintained scenario fixtures during the scenario work.

## Follow-up progress

- Added TDD coverage for working ArrowUp, holding history through 300 appended items (past retention), and F returning to the newest output.
- Added internal scroll/page/follow commands. Viewed history references a bounded retained snapshot, so new events cannot move it or evict it while reading. Run command handlers do not receive navigation commands.
- Added multiline offset/clamping coverage. Dashboard suite: 142 tests after the boundary regression.
- Added maintained fake-output fixture at `packages/toolcraft-design/src/dashboard/testing/pipeline-scenario.ts`, and executable-by-agent QA instructions at `docs/plans/qa/pipeline-dashboard-qa.md`.
- Real PTY validation ran streaming, burst, failure, Unicode/ANSI, and empty scenarios. PageUp held a settled screen unchanged during 1.1 seconds of streaming; F resumed new output. All five q exits returned 0.
- Inspected narrow failure screenshot: current action clipping and excessive sidebar allocation are confirmed. Resized captures also lack right/bottom border cells; investigate renderer/pilot resize correctness. Empty fixture context is misleading and must be corrected before final QA.

## Terminal shrink frame repair

A new failing regression reproduced missing right/bottom frame cells by shrinking 100x24 to 50x16. The dashboard diff walked the old geometry and emitted blank writes outside the new screen; cursor clamping erased new edge cells. Resize now clears the actual terminal and resets the previous screen buffer before repainting. All 143 dashboard tests, focused ESLint and package typecheck passed. Five real terminal-pilot scenarios were repeated and resized screenshots now contain complete frames; narrow failure PNG was visually inspected. This resolves the border defect, not the narrow allocation/current-action issues.
