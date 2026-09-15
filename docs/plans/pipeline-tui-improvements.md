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

## Actual CLI/external agent signal evidence

Temporary fake Codex executable and terminal-pilot driver now exercise source CLI -> root SDK -> real pipeline -> agent-spawn -> external child, with isolated homes and plans. Completed reported 120 input / 45 output / 10 cached tokens and persisted done; failed exited 1 and persisted failed; q and Ctrl+C exited 130 with open task and no live fake child. Force quit leaves the run lock; each subsequent experiment must use a fresh plan identity. The initial apparent SIGTERM hang was this stale-lock wait, not signal evidence.

A fresh SIGTERM experiment validated an actual defect: exit 143 left the alternate dashboard on screen. The parameterized CLI cancellation regression failed for SIGTERM before the fix. Pipeline dashboard now registers the same cancellation callback for SIGINT and SIGTERM and removes both listeners on cleanup. 93 focused command/shared tests and focused ESLint passed. Real CLI SIGTERM repeated twice: exit 130, task open, child gone, restored primary summary. Restored screenshot inspected at /tmp/pipeline-cli-restored.png.

Actual live captures also expose raw JSON protocol rows duplicated beside rendered events, and agent-message text is buffered until another event/end. These are now validated follow-ups, not established successes from synthetic output fixtures.

## Remove duplicate raw protocol output

A parameterized CLI regression fed tee stdout and ACP events through the real callback wiring. The event-agent case failed because raw stdout appeared alongside the rendered response; the plain-output case retained live stdout/stderr behavior. Dashboard now derives protocol stdout from the agent's declared CLI adapter and suppresses raw tee display for that path. Rendered events remain visible; stdout fallback remains available when no events or live plain output were observed. This uses configuration capabilities, without provider-id branches.

94 focused command/shared tests, focused ESLint, and root build typecheck passed. Real CLI/fake external completed run showed readable agent/tool rows with no JSON records, correct done persistence and exact 120/45/10 token summary. /tmp/pipeline-cli-completed.png inspected visually. Its wrapped PID was not parsed by the temporary driver, so this run does not add child-liveness evidence. Existing successful cancellation observations with valid parsed PIDs remain separate. Delayed agent-message buffering is still open: the temporary fake emits a subsequent tool event to flush initial text for this presentation check.

## Bounded live agent-message previews

A new CLI generator regression failed because the first agent message was not published before requesting the next event. Two store regressions failed because replacing a message appended a duplicate and evicted an unrelated log at capacity. Output items now accept an optional stable id; reusing it replaces the retained preview in place through immutable state updates. Held history remains unchanged and all previews keep the existing size bound.

Moved ACP dashboard stream consumption into agent-spawn. First message text publishes immediately; consecutive message/reasoning deltas update a bounded keyed preview. Subsequent preview formatting coalesces over 16ms, flushes at block boundaries/end/error, and cancels pending timers on exit. A failing burst regression measured 101 renders instead of two before coalescing. Package tests cover live visibility while the iterator remains active, block ordering, retained bounds, coalescing, and flush/no-scheduled-writes after thrown execution.

Same local 1,000-delta benchmark: initial live implementation 2,697ms / 1,000 previews; coalesced 58ms / two previews. Maintained design tests passed 1,733 cases; agent-spawn passed 546 with required loopback access; selected build closure and package/root typechecks passed. Initial sandboxed receiver tests failed EPERM and passed with loopback access. Full npm test and repository lint are running; no broad-pass claim yet. Design generation passed without tracked text changes.

Added maintained external fake native-agent fixture and Markdown CLI QA procedure. Actual CLI -> SDK -> engine -> external child verified completed, failed, SIGTERM, Unicode data flow, and sustained burst outcomes, exact persisted statuses, valid child termination, and restored primary screens. Text appears before execution ends without a subsequent tool event. Burst held logs stable across 1.1s, resized 50x16 and resumed F; screenshot inspected. Unicode PNG shows a border-alignment anomaly requiring terminal-model versus PNG-renderer investigation. Executable-bit loss caused one invalid real-agent 401 attempt; the corrected isolated executable wrapper is verified with command resolution before runs.

Remaining: full-check results, complete root limit/empty/multi-task paths, force-quit lock/startup clarity, Unicode/ANSI/tiny-terminal audit, memory measurements beyond bounded previews, and final requirement-by-requirement audit. Goal remains active; nothing pushed.

Live-preview cancellation follow-up: fresh actual CLI q, SIGINT, and Ctrl+C runs all exited 130, kept the task open, stopped valid parsed fake child PIDs, and restored primary screens. SIGTERM was already verified with the same live fixture. The broad npm test remains active and has reported current safe-python failures (including bytes-iterator and frozen-code introspection); its concurrent code is outside this TUI change and remains untouched. Repository lint is also still active. No full-check success is claimed.

Unicode alignment diagnosis: captured the real terminal-pilot screen at 100x24 during response 5. Every line has exactly 100 display cells; all sidebar/output boundaries are at cells 66 and 99, including CJK/ZWJ/combining rows. The dashboard terminal frame is intact. The PNG discrepancy is in terminal-png: SVG text uses natural font advances without terminal-cell placement, while bundled JetBrains Mono lacks these glyphs. Investigate/fix that renderer with TDD rather than changing correct dashboard cell geometry. Current screen evidence: /tmp/pipeline-live-unicode-screen.json.

Repository lint terminated exit 2 with complete=false, zero diagnostic errors/warnings, and 12,000 linted subjects; the remaining tree was not evaluated. This is an incomplete broad check, not a lint pass. Focused maintained design lint and explicit touched-file ESLint remain green. Broad npm test is still active with safe-python failures.

## Accurate raster terminal-cell placement

Four failing SVG regressions reproduced natural-font positioning after CJK, joined emoji, flags, and styled tabs. Initial span positioning fixed the large Unicode drift but raster inspection revealed a smaller mismatch with naturally advanced ASCII rows. A fifth failing regression established that all ordinary glyphs need the same terminal grid. SVG now groups ordinary characters, explicitly positions each on the cell grid, and isolates wide/combining graphemes at their own column. Tabs advance columns without emitting a control glyph. Shared grapheme segmentation avoids rebuilding a segmenter for every character.

All 73 terminal-png tests, touched-file ESLint, package typecheck, and selected maintained workspace build passed. Re-rendered the captured real Unicode screen and inspected /tmp/pipeline-unicode-fixed.png: sidebar and outer borders now align on every row. Bundled font coverage still renders unsupported CJK/emoji as placeholders; this establishes faithful cell placement, not glyph coverage. Forced design documentation generation passed and regenerated its tracked raster examples; dashboard example inspected.

Actual CLI three-task verification also passed with isolated fake binaries and parsed persisted plans: progression -> done/done/done, three tracked child jobs, 360/135/30 input/output/cached tokens; max-runs 1 -> done/open/open, one child job, 120/45/10 tokens; nothing_to_run -> done/done/done, zero child jobs, zero usage. All exited 0 and restored the primary terminal. Captures /tmp/pipeline-limits-{scenario}-{live,restored}.png.

The broad npm test is now terminal, exit 1: shared phase reported 58 failed files, 2,228 passed files, 1,786 failed tests and 116,277 passed tests. Safe-python failures were observed during the run; do not attribute every broad failure without the complete failed-file report. Subsequent workspace phases/posttest did not establish a successful full route. Broad lint was already terminal/incomplete at its 12,000-subject guard. These broad gates remain unresolved; no push or release has occurred.

## Force-quit cleanup and same-plan restart

The shared force-quit helper exited synchronously before the engine could release its run lock. A failing regression reproduced immediate exit and repeated teardown. Pipeline now supplies a cleanup-completion promise: Ctrl+C aborts and restores the terminal immediately, then exits 130 after the engine and dashboard cleanup complete. Repeated force-quit commands do not schedule duplicate exits. Other dashboard consumers retain their existing exit behavior.

96 focused CLI/shared tests passed, including both quit modes and cleanup ordering. Touched-file ESLint and root build typecheck passed. Actual source CLI with an isolated fake external agent verified Ctrl+C -> exit 130, task open, parsed child PID gone, primary screen restored; immediate same-plan retry became active in 1,028ms and completed exit 0/task done. Inspected /tmp/pipeline-force-quit-restart.png. This does not reclaim locks left by SIGKILL or a machine crash. A mistakenly named terminal-pilot key was corrected to Control+C before the valid run. An exploratory full-tree tsc invocation hit its default heap limit; the maintained root build typecheck passed.

## Readable active task titles

The real CLI screenshot displayed fake-1 despite receiving Fake external task from the engine. The existing progress regression failed when expecting the supplied title. Current action now uses taskTitle, falling back to taskId for an empty title, and retains task/step progress. 96 focused tests, touched-file ESLint, and maintained root build typecheck passed. Actual CLI screenshots inspected at 100x24 and after resizing to 50x16: title readable in the sidebar and compact action row; run completed with exact usage, done persistence, child stopped, primary screen restored. Design generation passed with IPC access and no final tracked artifact changes. Exploratory full-tree tsc exhausted both default and 8GB heaps; no full-tree typecheck success is claimed.

## Startup and lock contention

Failing package/CLI regressions reproduced absent lock-wait feedback and an empty startup current action. Dashboard now publishes selected configuration before SDK preparation, shows Preparing pipeline, and switches to Waiting for another run on actual contention. Pipeline exposes onLockWait(planPath), forwarded by the SDK and callback-merging type surface; notification occurs once per acquisition attempt, not every retry. Plan resolution clears the wait action before task progress.

Real concurrent source CLI/fake-agent QA then exposed q during lock waiting exiting 1. A failing package regression now expects the normal cancelled result. Cancellation before execution starts returns cancelled with zero runs; cancellation after run-lock acquisition releases owned locks first. Existing mid-execution error/release-failure handling remains covered by SDK concurrency tests. No live-owner lock is reclaimed or removed by a waiter.

362 focused package/SDK/CLI/callback tests passed, plus touched-file ESLint, pipeline typecheck, root build typecheck, and maintained selected workspace build. Actual owner/waiter QA: waiter q -> exit 130 in 21ms while parsed owner PID remained alive; owner q -> exit 130, child gone. Separate release/resume QA -> waiter completed exit 0/task done in 1,677ms after owner quit. Inspected 100x24 and 50x16 waiting screenshots and resumed screenshot. Full maintained npm test/lint have been restarted with complete output captured at /tmp/pipeline-tui-full-{tests,lint}-20260914.log; results pending.

Design generation for startup/wait feedback passed with required IPC access; no final tracked artifact changes. Spotted terminal-pilot qa:cli as an executable QA script (36 named cases); convert it to a Markdown procedure after the currently running full route is terminal, preserving coverage without changing task membership mid-run.

## Remove redundant native-protocol capture

Source audit found native ACP execution capturing full raw stdout while its result never uses that captured string. Two failing regressions validated selective capture and native execution wiring. Internal execution now supports captureStdout=false while captureOutput keeps callbacks, stderr capture, activity tracking, and drain behavior. Native ACP uses it; ordinary command capture remains unchanged.

Measured actual shared stream consumption with 64MiB synthetic chunks in separate GC-enabled processes: full capture forwarded/retained 67,108,864 bytes, 67,310,864-byte retained heap delta, 54ms; selective capture forwarded all bytes/retained zero stdout, 202,616-byte heap delta, 26ms. Stderr diagnostics retained in both. This demonstrates one removed copy, not total process memory bounds; event queues/adapters and stderr retention remain to audit.

104 focused execution/ACP tests and maintained 546-agent-spawn suite passed with local receiver access. Selected workspace build, touched-file ESLint, agent-harness-tools/agent-spawn typechecks, and root build typecheck passed. An overlapping typecheck initially encountered the config package dist during its rebuild and passed after build completion. Actual source CLI/fake external completed and failed paths passed with persisted statuses, exact usage, child termination, primary restoration, and live screenshot inspection. Full maintained checks started before this latest fix remain live; no broad-green claim.

Repeated maintained repository lint finished exit 2 with complete=false: 12,000 subjects linted, zero emitted diagnostics, 12,001 configured subjects at the admission boundary. The guard again stopped the broad check; later type/workflow stages did not establish a full lint pass. The full test session is still live and its saved log contains failures. Do not count this run as validating the latest stdout-capture fix: it began before that edit.

## Tiny-terminal hint fitting

Actual Unicode/ANSI fixture resized through 40x10, 20x6, 10x5, 5x3, 2x2, 1x1, then 100x24 without a crash; q restored the primary screen. Screenshots exposed q Quit becoming q Qui... at ten columns and only dots at five. Three failing regressions validated complete hint fitting, a key-only fallback, and joined emoji keys being split/overwritten. Footer now fits complete hints in order, falls back to the first key when no full hint fits, and advances graphemes by terminal-cell width.

1,735 maintained design tests, maintained design lint/typecheck, and selected workspace build passed. Repeated PTY resize sweep shows q Quit at 10x5 and q at 5x3; screenshots inspected. At 2x2/1x1 no interior footer can exist, but input and resize recovery remain functional. 40x10 retains logs plus summary; 20x6 prioritizes status/action over logs. Do not infer useful content at dimensions that cannot hold it. Forced design generation passed for this visual change; no tracked raster changes remained.

## Incremental session output aggregation

Session capture rebuilt messages.join for every streamed agent message. Exact local 8,000-message, 2,247,999-character measurement took 2,231ms; a new regression failed its one-second interactive budget at 1,434ms. Output now appends the next text and its existing newline separator incrementally while preserving messages, tools, preloaded input, and event delivery. Same measurement after fix: 10ms, same message count/output length. The passing regression is fast; it exercises live first-message availability and complete retained output with a generous latency ceiling.

Maintained agent-spawn suite passed 547 tests; focused ESLint, agent-spawn typecheck, and selected workspace build passed. Actual external fake burst held logs unchanged over twenty seconds, resized to 50x16, resumed follow to current response 1833, cancelled exit 130 with task open/zero completed usage, stopped parsed child PID, and restored primary screen. Held/narrow screenshots inspected. The sampled RSS belonged only to the terminal session PID (tsx launcher), so it is not evidence for the complete CLI process tree.

Repeated full npm test is terminal, exit 1 after shared phase: 63 failed files, 2,229 passed, 2 skipped; 1,796 failed tests, 116,308 passed, 2 skipped; 814.34s. Saved report identifies 60 safe-python failed files and three relevant files. Two relevant failures are the new stdout-capture red regressions observed while edits were in progress; both pass in subsequent focused runs. Third was the execution-env architecture snapshot line 102->104 caused by the new option; refreshed with its four tests and lint passing. Full maintained route never completed later phases; no full-pass claim. Full lint remains terminal/incomplete at its subject guard. Next full route must observe a stable completed edit set.

## Functional terminal-pilot screenshot path

Executing the QA procedure through actual CLI commands exposed screenshot --output <png-path> being rejected as a global response format. A failing CLI regression showed the positional path was also rejected. Screenshot now declares output as positional, keeping the existing handler/SDK field while allowing screenshot <png-path> -s <session>; normal and JSON response modes pass focused regressions. Existing --output remains the global format control, so use the positional destination.

Maintained terminal-pilot suite passed 289 tests after this change; additional focused JSON variant passed with three screenshot tests. Touched-file ESLint and package typecheck passed. Actual isolated daemon CLI captured greeting/menu PNGs, inspected visually, verified ArrowUp wraps to Option 3 and exits zero, and finished with an empty owned-session list. Screenshot rendering is mocked in unit tests, so no unit-created image files. The old literal spelling also failed during procedure execution; documented --literal=true works without a code change.

## Honest intermediate step completion

Actual CLI setup/implement/review/teardown screenshots showed Task work done after implement while Tasks remained zero and review was still active. A parameterized CLI regression failed for explicit taskCompleted=false. Completion formatting now identifies the completed step in that case, reserving task-done wording for final completion. Existing callbacks without the explicit flag retain their prior presentation.

97 focused CLI/shared tests, touched-file ESLint, and root build typecheck passed. Actual four-execution source CLI/fake external phase run passed: implement/review both done, finalization completed, four tracked child jobs, two task-step runs, one completed task, four completed steps, 480/180/40 input/output/cached usage, exit 0/restored primary terminal. Setup/review/teardown screenshots inspected. Temporary driver initially expected teardown_completed; authoritative persisted completion is completed, corrected before the valid run. No pipeline state change was needed.

Phase screenshots also show occasional empty stage-prefixed rows and a partial token-label row near stage transitions. These remain a presentation follow-up to diagnose against stored output versus terminal frame; do not change rendering without reproduction evidence. Session/event transcript retention and slow-consumer queue growth remain broader memory limitations, beyond the removed raw stdout copy and bounded dashboard previews.

## ACP separator cleanup

Captured review-frame JSON confirmed the empty stage-prefixed row was real content. Terminal ACP usage rendering intentionally writes an empty separator before its token line; the dashboard line buffer turned it into a timestamped stage-only entry. A failing adapter regression reproduced the leading newline. The dashboard adapter now removes empty writer entries at event boundaries, preserving internal message paragraph breaks and normal CLI rendering.

Maintained agent-spawn tests passed all 548 tests with loopback permission (the initial sandbox run failed four OTEL receiver tests with EPERM). Touched-file ESLint and selected agent-spawn build closure passed. Actual setup/implement/review/teardown PTY run again exited zero, completed four child jobs and persisted finalization, and reported 480/180/40 usage. Inspected review screenshot confirms the usage separator row is gone. Wrapped token output remains complete; the previously reported partial token label has not been validated as loss or stale rendering.

## Identify failed phases

Real isolated setup and teardown failure runs both printed Pipeline failed at undefined; review failure correctly identified work (review). Two failing engine simulation assertions confirmed missing execution identity. Phase failure/cancellation results now include lastTaskId matching the existing phase progress taskId (setup/teardown), so SDK callers and existing CLI failure formatting receive the execution name without another result field.

All 235 maintained pipeline tests, touched-file ESLint and selected pipeline build closure passed. Actual setup/teardown reruns exited 1 and restored the primary terminal; inspected final screenshots correctly name setup/teardown. Setup left both task steps open with one child job; teardown left both done and finalization pending with four jobs. These runs separately reproduced failed executions being counted as completed steps; that metric issue is pending a separate fix.

## Count only successful steps

Actual failure summaries counted setup failure as one completed step, review failure as three, and teardown failure as four. Four failing engine assertions covered setup, teardown, intermediate task failure and failed task usage. Both phase and task execution now increment stepsCompleted only after success; reported usage and failed-task counters remain available.

All 235 maintained pipeline tests, 97 CLI/shared tests, touched-file ESLint and selected pipeline build closure passed. Actual isolated failure reruns restored terminals and correctly reported 0/2/3 completed steps for setup/review/teardown failure, with exit 1 and unchanged expected persisted state. Final screenshot inspected. No release or remote delivery performed.

## Phase retry QA

Executed same-plan one-shot failure/retry pairs for setup, review and teardown. All second runs exited zero and finalized completed. Setup retry ran all four executions (five cumulative jobs, 480/180/40 usage). Review retry ran setup, review and teardown without rerunning completed implement (six cumulative jobs, one task run, three completed steps, 360/135/30 usage). Teardown retry ran only teardown (five cumulative jobs, zero task runs, one completed step, 120/45/10). Restored retry screenshot inspected. No retry implementation change was needed.

Current unresolved audit includes session/event transcript retention, slow-consumer line/event queues, pathological terminal input, and remaining manual QA cases. Existing broad npm test/lint failures recorded above are not successful full validation; focused tests and builds for the new fixes pass. Work remains active and local-only.
