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

## Output burst coalescing

A failing fake-timer regression observed 100 terminal writes from 100 consecutive output events. Output-only store changes now schedule one repaint after 16ms, using the newest retained state. Navigation, resize, and stats changes render immediately and clear pending repaint. Output arriving while a bounded history snapshot is held does not schedule unnecessary repaint. Stop/destroy cancel pending timers, with regression coverage that no writes follow terminal restoration. All 144 dashboard tests and all 1,718 design package tests passed, as did the maintained design lint/typecheck route. Five terminal-pilot scenarios were repeated successfully; PageUp held live-stream history, F resumed latest output, shrink frames remained complete, and q exited all scenarios with code 0. Updated burst screenshot was inspected.

## Complete action wrapping and Unicode metric alignment

Three failing regressions proved that current-action stage text was discarded and wide metric labels exceeded their allotted terminal cells. Stats actions now reuse the dashboard's grapheme-aware wrapping and retain the complete stage; key/value padding, clipping, and render offsets use display-cell widths. Added coverage for a one-cell action column. All 148 dashboard tests and the maintained full design package unit route passed, with design lint/typecheck. Five real terminal-pilot scenarios were repeated; the visually inspected 50x16 failure screenshot now includes `(implement)` on a second line. All q exits were 0 and streaming scroll/follow checks passed.

`npm run generate:design-docs` completed successfully after allowing required local tsx IPC; its only tracked textual change is generated table whitespace in the JSON design reference. `npm run screenshot-poe-code -- pipeline run --help` completed its uncached workspace build and produced `screenshots/pipeline-run-help.png`, which was visually inspected. These help checks do not establish real pipeline callback or cancellation correctness. Short-height action prioritization and narrow log-space allocation remain open.

A separate real terminal-pilot sustained burst check measured q-to-exit at 9ms (single local sample, code 0); this is responsiveness evidence, not a comprehensive latency benchmark.

## Task context in short terminals

Two new failing render regressions proved that a three-row stats pane hid the current action behind counters. Stats rendering now prioritizes status and action when the complete panel cannot fit, removes empty spacer rows, and displays remaining metrics afterward. If wrapped action rows exceed the available height, the last visible action row ends with an ellipsis. Full-height panel ordering remains covered by the existing renderer tests.

All 150 dashboard tests, all 1,724 design package tests, maintained design lint/typecheck, and 89 pipeline/shared-dashboard command tests passed. Real terminal-pilot failure scenario shrank/grew through 80x10, 80x6, 50x10, 140x40, and 100x24; task context stayed visible and all frames remained intact. q exited 0. `/tmp/pipeline-context-80x6.png` was visually inspected and showed both failed task and `(implement)` despite the two-row content area. Design documentation generation completed successfully and produced no additional tracked changes.

Remaining: narrow width allocation, honest empty fixture state, real pipeline fake executions/cancellation, pathological output/memory measurements, and completion audit.

## Clear stale context after thrown execution

A command-level failing test drove the real CLI callback orchestration with a fake SDK execution: task start set the action, then execution threw. Error status updated, but the previously displayed task action remained because `syncStats` omitted `currentAction` when undefined. The stats store merges partial updates, so omission cannot clear an earlier value. Pipeline now sends the field explicitly, including undefined. The regression checks merged displayed state and stop/destroy cleanup.

All 240 focused pipeline/shared-dashboard/dashboard tests passed. Focused ESLint and root build typecheck passed. Added `execution-error` fake visual scenario; real terminal-pilot verified error status with no stale Current section, captured `/tmp/pipeline-execution-error.png`, and q exited 0. Screenshot visually inspected. This covers thrown-error state updates; full real fake-agent pipeline PTY cancellation remains pending.

## Real pipeline engine terminal scenarios

Added `tests/fixtures/pipeline-tui/engine-scenario.mts`: actual pipeline engine, in-memory plans and logs, fake streaming agent, live engine progress callbacks, and real shared quit-command registration. Terminal-pilot verified completed/failed/max_runs/nothing_to_run/cancelled outcomes and exact persisted statuses for all three tasks. q during fake streaming produced cancelled, exit 130, and all tasks still open. Failed execution exits 1. SIGINT cancellation and immediate Ctrl+C both restored the primary screen and exited 130; screenshots inspected. Pipeline package's maintained test route passed 233 tests and fixture ESLint passed.

The engine fixture fills an integration gap beyond synthetic dashboard output, but does not prove the root CLI SDK wrapper/external child-spawn path. QA remains the Markdown procedure in `docs/plans/qa/pipeline-dashboard-qa.md`; the committed executable is the fake application under test, not a QA script. Remaining root CLI/spawn terminal validation, narrow layout, output/memory stress, and final completion audit stay open.

## Full-width compact layout for narrow terminals

Two failing regressions proved that 50-column logs received only 20 cells and could not show both task context and a readable error. Layout now switches to a compact summary when the requested sidebar would leave fewer than 40 output cells: status/metrics and current action occupy up to two rows, and logs use the complete interior width. Wide layouts retain their sidebar. Runtime and static snapshots render the same compact summary. Labels are normalized with the ANSI parser, then clipped by grapheme/cell width with an ellipsis; a third failing regression proved decorated multiline context needed normalization.

All 153 dashboard tests passed and maintained design lint/typecheck passed. Five real terminal-pilot synthetic scenarios repeated at 100x24 and 50x16; streaming history/follow and q exits stayed correct. Inspected `/tmp/pipeline-failure-narrow.png`: full task/stage visible and error message on one line. A further shrink/grow sequence across 80x10, 80x6, 50x10, 140x40, and 100x24 verified compact/sidebar transitions, task visibility, and complete frames. Required design generation completed without tracked output changes.

Remaining scenario correctness: the synthetic empty fixture still inherits illustrative task/usage context; the real-engine nothing_to_run fixture is accurate. Root CLI/external spawn PTY validation and pathological output/memory stress remain open.

## Bound oversized output previews and wrapping cost

Two failing store regressions showed that message-count retention left individual and total retained text unbounded. Oversized dashboard messages now retain a latest-text preview of at most 16,384 UTF-16 code units, including a visible truncation notice. Where possible the preview begins at a complete logical line; surrogate boundary handling avoids retaining half a pair. Caller messages remain untouched. Bounded tails are materialized to avoid retaining the original large string backing store through a substring. The active store holds at most 256 previews (4,194,304 code units); a held history snapshot can retain a second bounded set. This is a dashboard preview bound, not a bound on caller data, pipeline logs, process-wide heap, or pending child-output line buffers.

Concrete local render samples using the same 600,013-character fake message and 80x24 viewport: unbounded wrapping 292.9/247.6/253.5ms; bounded 16,384-character preview 6.5/6.1/6.1ms. Samples are local observations rather than hardware-independent thresholds. Retention regressions and a surrogate-boundary case passed. Maintained design lint/typecheck and full design test route passed; the separately added boundary regression also passed its focused run.

Added oversized fake visual scenario. Real terminal-pilot verified latest result visible, PageUp reached the truncation notice, F returned to the latest result, and q exited 0 (single observed 7ms q-to-exit). Inspected `/tmp/pipeline-oversized-marker.png`. Caller/full-log preservation is enforced by the store regression, not inferred from the screenshot. Remaining root CLI/spawn validation, pending line-buffer growth, accurate synthetic empty state, and completion audit remain open.

## Bound pending newline-free child output

Two failing shared-helper regressions reproduced unbounded accumulation before the store's preview limit: 110,013 pending characters and an oversized completed line. The line buffer now lives in toolcraft-design, shares the store's preview policy, bounds pending tails, preserves CRLF handling, and resets truncation between lines. Root consumers use a direct re-export. Native JSON string copying materializes bounded tails without the measured per-character copying regression.

Maintained design tests passed 1,730 cases; maintained design lint/typecheck and selected workspace build passed. Pipeline/shared/experiment-ralph consumer tests passed 250 cases. A 1,000-chunk, 1,200,013-character local benchmark measured original unbounded helper about 96ms versus bounded helper about 46ms; emitted output fell to 16,384 characters while preserving LATEST RESULT. This bounds retained preview state, not the incoming chunk or full persistent logs.

Added newline-free fake terminal scenario using the actual package line buffer. Terminal-pilot verified latest text, PageUp truncation notice, F follow, and q exit 0 (single observed 16ms). Marker screenshot visually inspected. Remaining root CLI/external spawn integration, accurate synthetic empty state, pathological terminal sequences, and completion audit remain open.

## Honest empty fake scenario

A failing fixture regression proved an empty run displayed 24,000 input tokens, 7,000 output tokens, 65 seconds, and an illustrative active task log. Empty now initializes only done/zero-usage/no-work state and emits no task execution log. The fixture regression, fixture ESLint, and package typecheck passed. Five PTY scenarios repeated at 100x24 and 50x16, all q exits 0; streaming held history/follow passed. Empty screenshots inspected. The wide capture occurred before deferred output repaint, so the settled narrow capture establishes the no-work log text; both establish zero displayed usage.
