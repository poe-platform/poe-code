# Pipeline TUI improvements

## Objective

Improve the pipeline TUI through varied fake scenarios, real terminal-pilot interaction and screenshots, measured performance improvements, and regression coverage. The initial work list and final verification audit are complete. Results and limits are tracked below.

## Current evidence (2026-09-14)

- Pipeline uses the shared toolcraft-design dashboard in `src/cli/commands/pipeline.ts`.
- Output and stats updates synchronously repaint the dashboard. Output rendering previously wrapped every retained item before selecting the viewport.
- A failing regression test proved that hidden history was parsed even when the newest item filled the viewport. Rendering now walks backwards and stops once enough rows are available. All 140 dashboard tests passed after the change.
- Real terminal-pilot fake run: 200 tool messages, task 2/8, 31,000 tokens, long current action; tested at 100x24 and resized to 50x16. Quit exited successfully (code 0).
- ArrowUp left the screen unchanged. Pipeline advertises Scroll and Follow, but dashboard command types and defaults have no matching commands. This is validated missing functionality.
- At 100 columns the current action is silently clipped, and task/stage context scrolls out with logs. Metrics take up a large mostly empty sidebar.
- Screenshots captured in `/tmp/pipeline-dashboard-baseline.png` and `/tmp/pipeline-dashboard-narrow.png`. Narrow screenshot was captured before resize output settled: it is not sufficient evidence for responsive layout correctness. Re-run with explicit screen expectations.

## Initial work list (completed)

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

## Native line queue burst cost

Direct current-source line-queue measurements drained 20,000/100,000/200,000 lines in 158/3,731/16,207ms, confirming repeated Array.shift cost. A real spawn-path regression failed at 1,950ms for 60,000 messages, preserving order but exceeding its one-second bound. The line queue now advances an index, releases consumed slots, clears drained storage and periodically compacts consumed prefixes. It preserves complete protocol lines; no transcript truncation or queue admission cap was introduced.

The same spawn regression passed at 439ms; direct queue samples fell to 7/17/42ms. All 549 maintained agent-spawn tests, touched-file ESLint and selected agent-spawn build closure passed. An actual 60,000-event CLI burst initially timed out waiting for the latest result screen; owned processes were confirmed terminal afterward. Child status showed exit zero, but the plan remained open after QA cleanup interrupted the consumer. This is incomplete end-to-end burst evidence; a longer held-completion observation is in progress. Remaining event-queue/consumer cost must be measured separately.

Extended thirty-second held-completion finite-burst run passed: LATEST BURST RESULT visible at 14,693ms, screenshot shows responses 59,981 through 59,999 and marker, child gone, exit zero, task done, 120/45/10 usage, restored primary summary. Thirty-one-second reported duration includes the deliberate child hold and is not processing latency. Native line queue improvement does not resolve this fourteen-second downstream consumer delay. Current spawn logging awaits stat and appendFile per event; measure that and event-queue draining before selecting another optimization. Do not weaken append-failure rollback or complete transcript contracts.

## Materialize live previews at publication

Isolated 60,000-event consumer measurements: logging 1,731ms, session capture 38ms, dashboard aggregation 3,001ms. A failing dashboard regression reproduced roughly three-second aggregation. The design package now supplies a bounded chunk preview buffer; ACP streaming pushes deltas into it and materializes text at scheduled publication or block completion. Complete transcripts remain untouched. Oversized deltas are materialized as bounded tails; consumed chunks are released. Empty deltas do not accumulate slots.

Eight focused regressions cover publication, errors/timers, separator cleanup, burst speed, bounded tails, paragraph breaks and oversized Unicode input. The new burst regression runs about 78ms for the whole file; isolated dashboard aggregation measured 65ms after the change. All 1,738 maintained design tests and 550 maintained agent-spawn tests passed, along with design lint/typecheck, agent touched-file ESLint and selected agent-spawn build closure. Real same-size held-completion CLI burst passed at 13,394ms to latest marker, exit zero, done task, correct usage and restored terminal; latest screenshot inspected. Prior 14,693ms and current 13,394ms are individual end-to-end samples, not proof that all remaining latency is resolved. Combined real-disk logging and timed rendering, event queue draining and retained transcript memory remain to profile. No README additions or visual-language change introduced.

## Track generated log sizes in bytes

Combined real-disk logging/publication measured 13,232ms without pane painting and 12,237ms with 2,008ms spent painting. A profiled repeat measured 4,103/4,396ms, demonstrating substantial wall-clock variability; idle time dominated samples, while fstat and writeBuffer were prominent active costs. Do not attribute all earlier fourteen-second latency to painting or Markdown parsing. CPU profile is temporary /private/tmp/pipeline-combined.cpuprofile.

A failing in-memory logging regression proved UUID-named generated logs statted their file again for each event despite one writer. Those files now track successful UTF-8 append sizes after the initial stat; explicit and session-named paths retain fresh size checks. Every event is still appended before yield. Partial-append rollback remains in place, including a regression after a successful café/CJK/emoji event verifying rollback to the exact byte boundary. Existing append/open/fatal rollback tests remain green.

All 552 maintained agent-spawn tests, touched-file ESLint and selected agent-spawn build closure passed. Same-process real-disk 60,000-event logging comparison: session-named/fresh stat 1,676ms; UUID/tracked size 910ms. Actual CLI rerun with thirty-second hold first timed out before latest marker; confirmed owned processes terminal before repeating. Extended ninety-second held completion passed: marker at 6,230ms, inspected latest screenshot, exit zero, task done, correct 120/45/10 usage, no child and restored terminal. Ninety-one-second total duration includes the deliberate hold. Individual end-to-end samples remain variable and are not a latency guarantee. Main CLI process RSS sampled at 238,384KiB during the hold; this is one process, not whole-tree memory or a bound. Transcript/event retention audit remains open.

## Fragmented Unicode preview coverage

Added five bounded-preview cases splitting valid emoji/CJK/combining text into 1/2/7/257/16,383-code-unit deltas. All preserve the latest result and the preview cap without unmatched UTF-16 surrogates after truncation. No production change was needed. Eight preview tests passed in 375ms; the current design worktree's full maintained suite passed 1,750 tests, including the separate cursor-control fix pending its own commit.

## Unicode cursor cells and adversarial control fixture

Six failing ANSI regressions showed code-unit cursor accounting corrupted emoji/backspace output and misplaced CJK, combining-accent and tab overwrites. ANSI parsing now writes graphemes at terminal cell widths, reserves wide continuation cells, clears both halves of overwritten wide glyphs, applies combining marks to the preceding cell and expands tabs at terminal stops. The prior literal-tab parser expectation now reflects its actual expanded visible cells.

Added a maintained cursor-controls fake scenario after its selector regression failed. It includes CJK carriage-return overwrite, emoji/ZWJ/combining backspaces, tab overwrite, OSC/DCS hidden strings and unsupported clear/cursor sequences. Fixture regression confirms settled output rather than streaming fallback. Its intentional keepalive interval preserves the screen until q.

All 1,750 maintained design tests, design lint/typecheck and selected design build closure passed. Real terminal-pilot scenario at 100x24 -> 50x16 -> 30x10 -> 100x24 verified corrected text, no HIDDEN_ payload and q exit zero. Wide/short screenshots inspected; complete frames remained intact. Independent raw PTY controls produced A 界, blank-plus-X for emoji/ZWJ, X for combining accent and X       B for tab overwrite, matching the corrected parser. This is shared-dashboard/control-render evidence, not new root SDK/external-agent cancellation evidence. Existing unsupported-font placeholders remain separate from verified cell geometry. Broader control-byte and memory-retention audit remains active.

## Suppress nonprinting output and C1 terminal strings

Fourteen failing parser/pane assertions reproduced DEL, C1 ST/CSI/OSC/DCS bytes surviving rendered output and DCS/APC payloads becoming visible after an embedded BEL. Unstyled log output now routes nonprinting control bytes through the ANSI parser. It supports C1 equivalents of CSI and terminal strings, C1 next-line, and C1 ST; DEL and unsupported nonprinting controls are discarded. OSC may terminate at BEL; DCS/SOS/PM/APC stay hidden until ST. No raw control payload is emitted into dashboard cells by these paths.

Extended maintained cursor-controls fixture includes DEL, C1 clear, C1 OSC and DCS with embedded BEL. All 1,765 maintained design tests, design lint/typecheck and selected design build closure passed. Real terminal-pilot at 100x24 -> 50x16 -> 30x10 -> 100x24 verified leftright, C1 result text, hidden payload absence, intact frames and q exit zero. PageUp in the short view moved into earlier output; F returned to latest fixture text. Wide/history screenshots inspected. This resolves the validated log-output paths; it is not a general claim about every control string or arbitrary labels supplied to low-level ScreenBuffer APIs. Memory retention and broader execution/QA audit remain active. No remote delivery or release performed.

## Held consumer event backlog

A failing native event-queue regression held consumption until producer completion, then drained 100,000 ordered events in 4,260ms, exceeding 500ms. Event queues now use indexed reads, release consumed references and periodically compact, matching the previously corrected line-queue mechanics. Buffered events still precede completion/error. Full transcript retention is not capped.

Both burst regressions check every message order with a mismatch failure rather than allocating an assertion for each item. The new held-consumer check passes its unchanged 500ms drain budget; focused native burst/held backlog tests passed in 790ms total (native burst 523ms). Initial maintained runs failed timing/integration cases during major loading slowdown (20–33-second imports); these are failed runs, not passes. Stable maintained single-worker run passed all 553 tests with unchanged timing bounds, touched-file ESLint clean and selected agent-spawn build closure passed. No task membership changes or timeout increases were made.

Real dense-backlog q cancellation restored the terminal, stopped child and preserved open task/zero usage/exit 130, with pre-cancellation screenshot inspected. Observed q-to-process-exit was 44,265ms despite five-second CLI run summary. Authoritative child job ended 06:05:15.284 UTC; 42,330-event log last modified 06:05:58.954 UTC, confirming queued logging continued about 43 seconds after child termination. Cancellation of the presentation consumer is the next validated follow-up; do not describe this sample as prompt quit. This issue remains after queue mechanics improve and requires its own regression/fix.

## Stop cancelled presentation consumption

A failing dashboard regression aborted after visible and pending text, then observed all 1,000 buffered events consumed. The adapter now accepts the run signal, stops iteration on cancellation (closing the nested source), suppresses pending/in-flight publication after abort and clears its publication timer on cleanup. Pipeline passes its existing signal. Normal completion and execution-error text flushing retain their existing behavior. An idle source still relies on the spawned process cancellation to settle its pending read; no detached reader is introduced.

All 554 maintained agent-spawn tests and 88 pipeline CLI tests passed, touched-file ESLint clean and selected agent-spawn build closure passed. Earlier sandboxed suite failed four loopback cases; an overlapping build/PTY run failed three timing cases. These remain failed runs; final suite ran after those operations ended without changing timing limits.

Real 60,000-event held-completion cancellation after the build finished: q-to-process-exit 311ms, exit 130, open task, no child, zero usage and restored terminal. Job ended 06:14:53.407 UTC; the 414-event log stopped in the same second. A repeat launched before build completion loaded the old adapter and took 24,461ms; that is not fixed-code evidence. Pre-cancellation and restored screenshots inspected. Retrying the same cancelled plan with the maintained completed fake succeeded: exit zero, task done, one run/task/step, 120/45/10 usage and restored terminal; screenshots inspected. No remote delivery or release performed. Broader retention/adversarial QA and full gates remain open.

## Propagate native middleware iterator closure

A separate failing native regression confirmed early consumer exit never reached a middleware generator's finally block: the public wrapper only forwarded next(), omitting return(). It now waits for middleware installation in an async generator and delegates the stream with yield*, preserving next/error/completion behavior and propagating closure. This also removes the handwritten forwarding iterator. Full native producer transcript retention remains unchanged; this fix does not impose a transcript cap.

All 555 maintained agent-spawn tests passed, touched-file ESLint clean and selected 17-build agent-spawn closure passed. Rebuilt actual CLI dense cancellation repeated at 251ms q-to-exit, child gone/open task/zero usage/exit 130/restored terminal; pre-cancellation screenshot inspected. This is a second individual prompt-cancellation sample, not a universal latency bound. No remote delivery or release performed.

## Dispose abandoned native delivery

A failing raw-native iterator regression confirmed there was no return() operation to discard held events. Native delivery now closes explicitly: it releases its queued slots, settles pending readers and stops queueing further delivery. Producer parsing, complete context transcript and usage continue independently until the child result completes. Three focused regressions cover held delivery, a pending read and preservation of subsequent transcript/120-input/45-output/10-cached usage. No transcript truncation or process cancellation is inferred from iterator closure.

All 558 maintained agent-spawn tests passed, touched-file ESLint clean and selected 17-build closure passed. Rebuilt actual CLI dense cancellation: 179ms q-to-exit, no child/open task/zero usage/exit 130/restored terminal; screenshot inspected. Full repository test/lint processes are still live; test has reported 72 safe-python failure records so far and no TUI/spawn failure records. These broad in-flight observations do not establish a full pass. No remote delivery or release performed.

## Maintained finite dense external fixture

The maintained fake Codex executable now accepts PIPELINE_FAKE_SCENARIO=finite-burst: initial PID/tool/message events, a 500ms pause, 60,000 numbered messages and LATEST BURST RESULT, then a 90-second completion hold. This replaces temporary generated executables for repeated dense backlog QA. A failing fixture regression first observed no dense messages; two in-memory VM/fake-clock regressions now verify every message order, held completion/usage and SIGTERM timer/output cleanup. Tests read the existing fixture but create no files or real processes. Both passed in 342ms; touched-file ESLint and node syntax check passed.

Actual source CLI/SDK/engine/native child with the maintained fixture verified early q at 253ms, exit 130/open task/no child/zero usage/restoration; screenshot inspected. Normal completion after the deliberate hold verified exit zero/done task/one run/task/step/120-45-10 usage/no child/restoration and an intact settled latest-result screenshot. The persistent log contains 60,005 events (60,002 agent messages plus session/tool/usage); content is intentionally redacted, so this log establishes counts/usage rather than payload order. The driver's 88,971ms wait-to-exit measurement includes the 90-second hold and is not a cancellation measurement. One earlier first-burst screenshot captured a partial diff repaint; settled latest output is intact, and terminal byte-pressure optimization is a separate follow-up. No remote delivery or release performed.

## Avoid cursor repositioning within adjacent rows

A failing terminal-driver regression measured 631 bytes for an 80-character plain row because every changed cell emitted a cursor-position sequence. Flush now tracks the cursor within each diff write and continues through adjacent cells; sparse changes and row transitions still reposition explicitly. Cursor advance uses grapheme cell width and skips wide continuation slots. Styling remains applied independently per cell. The same row emits 86 bytes, an 86% reduction; no general end-to-end latency improvement is inferred from this byte count.

Two regressions cover the byte budget and actual wide/ZWJ/combining/gap/row output. All 1,767 maintained design tests, maintained design ESLint/typecheck and selected design build closure passed. Actual cursor-controls PTY at 100x24 -> 50x16 -> 30x10 -> 100x24 verified wide/control results, hidden payload suppression, PageUp/F and q zero; wide/short screenshots inspected. The known PNG font fallback for CJK remains a capture limitation; raw terminal cells and frame geometry are correct. Rebuilt source CLI with maintained finite-burst cancelled at 228ms, no child/open task/zero usage/exit 130/restoration. Retrying an open cancelled plan with the completed fake passed exit zero/done task/one run-task-step/120-45-10 usage/restoration. No remote delivery or release performed.

Broad lint refresh terminated exit 2: configured 12,001, linted 12,000, zero diagnostics, complete false, subject cap at packages/safe-bash/tests/commands/core-regression-stress/resources.test.ts. Guard was preserved; remaining maintained type/workflow routes are separate follow-up checks. Full unit refresh remains live and has reported 72 safe-python failures plus two harness filesystem configuration failures. No broad-success claim is made.

## Refresh gate results and isolate cold runtime setup

The maintained lint:types route passed in full (root build typecheck and workspace contract checks), and lint:workflows passed. These separate successes do not make the admission-capped ESLint/full lint route complete. Its bounded default subject count is 12,000; current source-file candidate inventory is larger, but candidate counts alone do not authorize ignoring files or prove final configured membership. A compatibility-safe capacity audit remains open.

Harness filesystem configuration failures reproduced in a focused run: two five-second cold lazy-runtime transformation timeouts allowed prior invocations to leak into the next case's mock assertions (three failed/25 passed). The suite now initializes the tested runtime beside command setup, keeping CLI lazy-loading behavior and all assertions/deadlines unchanged. Focused run passed all 28 cases in 120ms; 17.25-second module transformation/setup is reported separately rather than hidden in a behavioral case. Touched-file ESLint passed. This is test setup only; no production filesystem routing changed.

Full unit process remains live and has reported 630 failure records: 628 safe-python and the two earlier harness cases. Focused corrected harness evidence does not turn that already-failed broad run into a pass. No TUI/spawn failure records observed so far; no full-unit success claimed. Further current-state scoped/broad validation and the original requirement audit remain open. No remote delivery or release performed.

## Repository lint admission capacity

The full maintained lint route concretely exhausted its 12,000-subject default. Increased only that bounded default to 20,000; byte, metadata, directory and provenance protections remain unchanged. All 279 maintained lint guard tests passed, including custom subject-cap rejection. The refreshed full route admitted and linted 14,063 subjects with zero diagnostics, but exited 2 with 58 filesystem-identity gaps caused by a directory changing during traversal. This is incomplete lint evidence, not a pass; the guard correctly rejected inconsistent snapshots.

## Metadata after held event delivery

A failing SDK regression awaited child completion before consuming its exported stream and lost subsequently captured usage/thread metadata. Streaming result fields now read captured metadata when accessed, preserving independent child completion and avoiding a consumer/result deadlock. The regression uses actual session and usage middleware and verifies the same result gains thread, output and 120/45/10 usage after consumption. All 161 SDK/pipeline CLI tests, touched-file lint and maintained lint:types passed.

Actual source CLI with an immediate 60,000-message completion finished exit zero, done task, correct 120/45/10 totals, no child and restored terminal. Early q in the same scenario exited 130 in 78ms, retained the open task/zero usage and left no child. The normal run's six-second observation includes event processing and is not quit latency. No remote delivery or release performed.

## Immediate completion and noisy tool fixtures

Two maintained fake-native scenarios extend adversarial QA: finite-burst-immediate completes immediately after 60,000 messages; tool-burst emits 20 unique tool start/completion pairs per 50ms until terminated. Each reproduced missing behavior with a failing fixture regression. All four VM/fake-clock fixture tests passed (408ms), verifying ordered messages/pairs, usage/completion timing and SIGTERM cleanup without real files/processes. Touched-file lint passed.

Actual tool-burst source CLI exceeded retention capacity, held history stable, resized 100x24 -> 50x16 -> 100x24, returned to latest output with F and cancelled in 24ms with exit 130/open task/zero usage/no child/restored terminal. Short and follow screenshots inspected. An earlier QA attempt waited for exact transient tool 300 and timed out; coalescing can skip that screen frame. The repeat used a numeric range; no production change was justified by the failed observation.

## Multiple dense tasks and performance observations

Actual profiled source CLI completed three tasks, each with 60,000 messages and a deliberate 90-second hold. History remained stable within holds and across task transitions; F resumed following. Final result: three done tasks/runs/steps, 360 input/135 output/30 cached tokens, exit zero, restored terminal and no owned processes. Third-task and held-history screenshots inspected. Main-process RSS samples after each burst were 355,456 / 327,616 / 269,968 KiB; owned-tree samples were 470,528 / 432,368 / 379,776 KiB. These profiler/allocator-dependent samples are not maxima or a memory bound.

The 274.74-second CPU profile contained 261.01 seconds idle. Largest sampled active functions were graphemes (1.482s), displayWidth (1.252s), garbage collection (0.912s) and wrapParagraph (0.451s). No broad throughput claim follows from this hold-dominated profile. An earlier unprofiled attempt observed only 23,902 events within its 60-second observation window and closed its session; it remains failed QA without an established cause.

The earlier maintained full unit run terminated with 49 failed files / 1,096 failed tests and 118,001 passing tests. Terminal-driver regressions observed the old per-cell implementation during that live run; current maintained design suites pass them. Harness configuration was fixed separately; replay-equivalence refresh passed all seven cases, including a 4.256-second coverage-demo case with unchanged five-second deadline. These scoped successes do not establish a full repository pass. No remote delivery or release performed.

## Filter hidden terminal strings before truncation and splitting

Five failing presentation regressions exposed hidden OSC/DCS payloads after preview truncation removed their opener and after line splitting discarded parser state. A shared streaming terminal-string filter now runs before preview retention and raw line splitting; the ANSI parser uses the same grammar. It retains only hidden/escape state across chunks, discards string payloads, preserves printable output and styling, accepts BEL only for OSC and accepts ST for all supported strings. Original execution transcripts/logs are unaffected.

Four additional split-size cases preserve SGR and OSC/DCS/APC grammar. The maintained cursor fixture now includes oversized DCS and multiline/chunked OSC, with its own initial failing expectations. All 1,776 maintained design tests, design lint/typecheck and selected design build closure passed. An intermediate fixture used a missing local buffer variable; corrected it before the successful final gates. Real terminal-pilot resizing 100x24 -> 50x16 -> 30x10 -> 100x24 verified both visible results, no hidden payload, intact frames and q exit zero; wide/short screenshots inspected. Full current repository unit/lint refreshes are running separately. No remote delivery or release performed.

## Deferred log status in SDK results

Two failing boundary regressions reproduced CLI and ACP result snapshots omitting a log-open failure that occurred during held event consumption. The existing spawn logger opens on first event, sets logError and removes an unusable logFile. Both streaming result paths now read these fields when accessed, preserving exit status and independent child completion. The tests inject this documented middleware transition and verify the same result changes after stream consumption. All 163 SDK/pipeline CLI tests, touched-file ESLint and maintained lint:types passed. This is SDK/logging metadata behavior with no visual CLI change. No remote delivery or release performed.

## Complete CSI controls at preview boundaries

Failing regressions exposed parameter digits when oversized CSI controls lost their prefix during truncation, and when an otherwise supported control straddled the retained-tail boundary. The streaming filter now holds complete CSI controls across chunks, with at most 1,024 retained characters per control; oversized sequences are discarded through their final byte. Tail retention advances past a control when its opener would be omitted. Supported SGR/cursor sequences remain unchanged; this is a bounded presentation policy, not transcript truncation.

Both ESC and C1 oversized forms are covered, plus supported-control boundary retention and existing split-size styling assertions. The maintained fixture gained a long-CSI result after its missing-output expectation failed. All 1,779 maintained design tests, design lint/typecheck and selected design build closure passed. Real terminal-pilot at 100x24 -> 50x16 -> 30x10 -> 100x24 showed the expected result without parameter leakage, preserved prior cursor/control output and quit zero; wide screenshot inspected. Broad current test/lint runs remain separate and active. No remote delivery or release performed.

## Keep Unicode coverage fast

The preview surrogate tests performed one matcher assertion per code unit; three individual cases took 719/346/394ms in the preceding maintained run. They now scan the same complete retained output, stop at the first invalid surrogate and assert that no invalid index exists. All five split sizes, preview limits and latest-text assertions remain intact. The complete 20-case preview suite passed in 532ms and touched-file ESLint passed. This removes matcher overhead without adding production code or weakening Unicode checks; host-dependent samples are not a timing guarantee.

## Safe labels and styled screen cells

Two failing screen-cell regressions exposed raw terminal controls through put/putInRect. Three additional failures showed filtering after layout was too late: hidden strings in titles erased the top border, footer hints lost their labels and metrics lost their iteration label. Labels now obtain visible plain text before clipping/fitting; buffer control paths parse text into styled cells and flatten line boundaries into spaces. Ordinary text retains its fast path.

The first buffer guard flattened styles, failing the existing explorer detail snapshot. Two direct regressions now enforce inherited/reset SGR cell styles. Corrected parsing preserves those styles and avoids counting escape bytes as occupied cells. Updated only the affected list-detail snapshot line, retaining all content and correcting padding/style serialization. All 1,787 maintained design tests, design lint/typecheck and selected design build closure passed. Maintained label-controls fixture first failed its missing-scenario expectation, then real terminal-pilot verified headings/metrics/footer/frames through 100x24 -> 50x16 -> 30x10 -> 100x24 and quit zero. Shared explorer-fixture terminal frame also inspected and quit zero; cell tests prove styles independently.

Actual source CLI with a long hidden OSC in its task title preserved visible context and frames at wide/narrow/short widths; q exited 130 in 72ms with open task, zero usage, no child and restored primary screen. Wide/short shared-label and wide external screenshots inspected. Earlier external QA asserted an unclipped full title at 30 columns; observation showed intentional clipping, and the corrected expectation passed without a production change. Broad gates remain live and failed so far; no repository-wide pass or remote delivery/release claimed.

## Unicode heading geometry

Four failing border regressions reproduced shifted junctions/corners for CJK, ZWJ emoji, combining accents and oversized CJK titles. Top-border titles now clip and pad by terminal-cell width, retaining complete graphemes and using the same ellipsis as other clipped UI text. Updated the ASCII clipping assertion to the explicit ellipsis behavior. The maintained unicode-title fixture first failed its missing-output expectation, then verified both panel headings in real terminal-pilot.

All 1,792 maintained design tests, design lint/typecheck and selected design build closure passed. An intermediate suite caught the prior ASCII clipping expectation and a fixture loaded before its implementation; final current-state suite passed. Actual PTY verified 140x40 -> 100x24 -> 80x24 -> 50x16 -> 30x10 -> 10x6 -> 5x3 -> 2x2 -> 1x1 -> 100x24, intact frames where geometry permits, complete recovery and quit zero. Wide/short screenshots inspected, with known raster glyph fallback separate from verified terminal geometry. Maintained npm run generate:design-docs -- --force passed uncached, regenerated all three references and screenshots without tracked changes; generated dashboard screenshot inspected.

Current full lint terminated exit 2: all 14,073 configured subjects linted, zero errors/warnings, no admission failure, but 15 filesystem-identity gaps left complete=false. Directory changes during traversal were correctly rejected. Current full units remain live with safe-python failures and a safe-bash bundle setup gate failure; no repository-wide pass or remote delivery/release claimed.

## Recover cancelled and restarted terminal controls

Five failing parser/preview regressions showed CAN/SUB left OSC/DCS/APC/CSI pending and hid later output, while ESC interruption of unfinished CSI exposed parameters and lost styling. Independent terminal-pilot model input produced the expected visible text for the same cancelled controls. The streaming filter now abandons pending control state on CAN/SUB and restarts escape parsing on ESC inside CSI, retaining bounded state and complete original execution transcripts.

All 1,797 maintained design tests, design lint/typecheck and selected design build closure passed; focused parser/preview coverage passed 70 cases in 305ms. Maintained cursor fixture added recovery markers after its expectations failed. Actual terminal-pilot at 100x40 -> 100x24 -> 50x16 -> 30x10 -> 100x40 verified new results plus prior cursor/control output, hidden payload absence, PageUp/F and quit zero. Wide/history screenshots inspected. QA uses a taller initial viewport now that the control fixture contains more rows.

The earlier full unit refresh is still live and has now reported the new label/heading regressions against modules loaded before those fixes. This mixed-state run began before those edits and cannot establish current broad validation. Final maintained current-state design runs pass those cases; a subsequent broad refresh must run while relevant sources remain stable. No repository-wide pass or remote delivery/release claimed.

## Isolate retry presentation state

A failing CLI regression reproduced an unfinished stderr OSC from a timed-out attempt hiding the successful retry warning, and partial stdout joining across attempts. Presentation buffers now belong to each attempt and flush before retry decisions. The maintained activity-timeout fake emits initial native events and a partial warning, then remains silent; its fake-clock regression proves silence for 600,000ms and SIGTERM timer cleanup. All 93 focused CLI/fixture tests, touched-file ESLint and maintained lint:types passed.

Actual source CLI terminal-pilot exercised the native 600,000ms inactivity timeout without shortening it. Started 2026-09-15T07:56:05Z; retry warning visible at 08:06:06Z; exit zero, exactly two owned children both gone, one completed task/step/run, persisted done, exact 120/45/10 usage and restored primary terminal. Inspected /tmp/pipeline-activity-timeout-retry.png and /tmp/pipeline-live-activity-timeout-retry-restored.png. No remote delivery or release performed.

## Show partial lines while agents are running

Two failing CLI regressions proved raw stdout and stderr were absent before the spawn result resolved. Added a package streaming line helper that previews bounded sanitized pending text under a stable output ID; completed lines replace their previews, and following lines get fresh IDs. Existing line-buffer callers retain newline/flush behavior. Pipeline wiring now passes those IDs into the dashboard. Four package cases cover immediate display, no duplicate stored rows, CRLF/flush boundaries, truncation/hidden controls and avoiding unchanged partial repaints. All 92 focused cases and all 1,801 maintained design tests passed; touched ESLint, design lint/typecheck, selected design build closure and maintained lint:types passed after refreshing exported package declarations.

Actual source CLI activity-timeout fake now displays its partial warning immediately while the process remains silent. Settled 100x24 -> 50x16 -> 30x10 -> 100x24 screenshots verify border widths, hidden-control/protocol absence, PageUp history and End follow. At 30x10 the newest wrapped agent message fills the viewport; PageUp reveals the retained warning. q returned 130, owned child gone, task open, zero usage and primary screen restored. Observed cancellation plus final capture 669ms, not calibrated input latency. Inspected wide, narrow, history and restored screenshots /tmp/pipeline-live-partial-*.png. Earlier QA failures captured stale package exports and insufficient resize settling; corrected rerun passed. No remote delivery or release performed.

## Preserve cells crossed by terminal tabs

Independent terminal-pilot model comparison reproduced ABCDEF\r\tX losing its prefix in dashboard parsing: the terminal retains ABCDEF  X, while the parser replaced the crossed cells with spaces. The same defect affected CJK cells and pre-existing red styles. Three failing ANSI regressions now enforce those terminal results. Tabs preserve occupied cells/styles and create spacing only where cells are absent. A failing maintained fixture expectation preceded the new tab examples. Focused ANSI/fixture checks passed; real 100x40 -> 100x24 -> 50x16 -> 30x10 -> 100x40 cursor/control QA passed PageUp/F/q zero, hidden-payload absence and tab results; wide screenshot /tmp/pipeline-tab-preservation-100x40.png inspected. Maintained design build closure passed. Design lint/typecheck passed. All 1,804 maintained design tests passed after the separately committed timing-test cleanup; the confirmation before cleanup had another 436ms/200ms budget miss. The first design run had 1,803 passes and one 235ms/200ms Markdown budget failure; isolation passed without code changes to Markdown. No remote delivery or release performed.

## Erase stale progress-line cells

Independent terminal-pilot model comparisons reproduced progress 100% -> progress 50%% despite CSI K, XXCDE despite CSI 1K, and retained CJK suffixes after erase. Six initial failing ANSI/fixture cases preceded the fix. The logical-row parser now supports default/zero erase-to-end, erase-through-cursor and existing full-line erase, clearing whole wide glyphs at crossed boundaries while retaining cursor position and styles outside the erased range. Final 58 focused cases and all 1,810 maintained design tests passed, with design lint/typecheck and selected build closure. Real 100x40 -> 100x24 -> 50x16 -> 30x10 -> 100x40 cursor/control fixture verified progress 50% without stale suffix, preserved tab/cursor rows and frames, PageUp/F/q zero; wide screenshot /tmp/pipeline-erase-line-100x40.png inspected. No remote delivery or release performed.

## Sustained interaction with live partial rows

Final partial-row source CLI ran the native ten-minute inactivity timeout from 2026-09-15T08:16:35Z to 08:26:35Z. Exactly two owned fake children exited; retry warning visible, task done, one run/task/step, exact 120/45/10 usage, exit zero and restored primary terminal. Current retry screenshot inspected. The unchanged first warning is currently emitted again at flush, refreshing its timestamp despite identical text; its position remains before older tool rows. Avoiding that redundant final update is a validated follow-up.

Three maintained noisy-tool repetitions passed history/resize/follow/cancellation with observed quit-to-exit 159/153/312ms. A five-minute continuous run completed ten 100x24 -> 50x16 -> 100x24 history/follow cycles, with rendered border width checks and quiet-terminal comparisons. Final q-to-exit 148ms, task open, zero usage, child gone, primary terminal restored. Follow screenshot reached noisy tool 122,487; held/narrow and followed/wide images /tmp/pipeline-tool-burst-five-minute-{history,follow}.png inspected. Ten main-process RSS samples ranged 408,656–573,712 KiB; these are allocator/load-dependent samples, not a bound. Two earlier stress attempts compared during partial redraws and failed on a transient clock fragment; captured command rows were identical. Corrected settling uses a 250ms quiet period before comparisons, and the final run passed.

Tiny-chunk benchmark measured 20,000 one-byte pushes at 1,723ms in the existing line buffer, 1,934ms streaming and 2,010ms with store updates. Profiled repeat attributed 14.029s across all benchmark cases to retainOutputTail, with 1.114s GC. Repeated tail materialization is a concrete optimization target; no copying-policy change or new memory guarantee is claimed by this evidence. Broad current checks remain separate. No remote delivery or release performed.

## Keep unchanged preview completion quiet

The native retry screenshot showed the first warning's timestamp jumping forward ten minutes on flush despite identical text, placing that new timestamp before older tool rows. A failing streaming-line test reproduced duplicate publications on newline and flush. Completion now publishes only changed text, preserves blank lines, resets the line ID and starts subsequent rows normally. All 93 focused package/CLI tests, all 1,811 maintained design tests, design lint/typecheck and selected build closure passed. Actual source CLI activity-timeout partial warning remained live through settled 100x24 -> 50x16 -> 30x10 -> 100x24, PageUp/End and q; exit 130, child gone, task open, zero usage and restored terminal. Observed cancellation plus capture 433ms. Current wide screenshot /tmp/pipeline-live-partial-100x24.png inspected. No remote delivery or release performed.

## Faster detached preview-tail copies

The profile attributed 14.029s of tiny-chunk workloads to JSON round-trip materialization. Added raw UTF-16 retained-tail coverage first; all 31 baseline cases passed before refactoring the copy to Buffer UTF-16 bytes and back to a detached string. This retains the same character budgets, terminal-control boundaries, surrogate handling and large-source detachment. All 128 affected preview/line-buffer/CLI cases and all 1,812 maintained design tests passed, with design lint/typecheck and selected build closure. Independent 28-case before/after comparison includes all 65,536 UTF-16 code units and lone-surrogate/ANSI/newline tails. GC-enabled 30-million-character-source checks retained 16,384 characters with approximately 11KB/near-zero sampled heap deltas in old/new runs, not a general memory bound.

Three-round interleaved same-process benchmark alternated implementation order and recorded CPU plus wall time during concurrent broad checks. For 20,000 one-byte pushes, median old/new CPU was 1,215/176ms and wall 1,407/194ms. For 20,000 sixteen-byte pushes, CPU was 2,032/297ms and wall 2,437/401ms. These scoped samples show about sevenfold lower line-buffer CPU cost, not complete-agent throughput. Earlier sequential comparisons were confounded by overlapping package checks and are not the basis for that claim.

Maintained newline-free fixture real terminal-pilot verified latest result, PageUp truncation notice, F following and q zero (58ms sample). Marker screenshot /tmp/pipeline-copy-newline-free-marker.png inspected. Refreshed repository lint terminated exit two with 14,091 configured/linted files, zero diagnostics and one docs/plans ancestor identity drift; not a completed lint pass. Full unit run remains separate and live. No remote delivery or release performed.

## Count automatic initialization in pipeline totals

Actual empty-plan CLI QA intentionally invoked SDK initialization and consumed fake 120/45/10 usage over about two seconds, but final summary showed zero tokens and zero duration. One failing SDK regression and two failing dashboard cases preceded the fix. A pipeline-package helper aggregates preparation usage/time into the existing engine result without changing task/run/step counts or mutating that result. SDK wiring enriches the existing plan-summary event with initialization usage; dashboard counters include it before task execution. No new configuration or environment option.

All 348 maintained pipeline-package plus SDK/CLI scope cases passed, including deterministic initialization duration, cached/uncached/absent usage, callback metadata, unchanged engine results, and initialized task counters. Selected maintained pipeline build closure passed; touched-file ESLint and maintained lint:types passed. Real source CLI empty initialization exited zero with one job, zero task runs and exact 120/45/10 plus two seconds. Temporary parser-based seeding wrapper followed initialization with three real engine tasks: four jobs, three done tasks/runs/steps, exact 480/180/40 and ten seconds. Live first-task dashboard showed preparation usage and zero completed tasks; both live/final screenshots inspected. An earlier QA launch during package rebuilding failed before refreshed exports were available; final rerun passed.

Repository lint completed its ESLint stage with 14,099 configured/linted files and zero diagnostics, then failed its type stage on exports being rebuilt concurrently with this change. This is not a full lint pass. The prior full unit run finished exit one with many failures, including sandbox EPERM loopback binding; no broad-pass claim. Refreshed full unit/lint runs use current stable pipeline sources and remain separate. No remote delivery or release performed.

## Preserve returned usage when cancellation wins

Initialization follow-up exposed an existing result/callback mismatch: task cancellation callbacks forwarded returned usage, but engine result metrics discarded it. Setup and teardown discarded returned usage entirely on the same abort boundary. Three failing engine regressions validated task/setup/teardown totals before moving aggregation ahead of the cancellation check. Cancelled phases now publish unsuccessful completion with known usage, while interrupted task/step success credit and persistence remain unchanged.

All 349 maintained pipeline-package plus SDK/CLI scope cases passed; touched package ESLint and selected maintained pipeline build closure passed. Maintained real-engine fake `cancelled-with-usage` now returns known usage at abort: real PTY confirmed 137/89/0 tokens, all tasks open, zero runs/tasks/failed tasks/steps, exit 130 and primary restoration. Ordinary AbortError path remained zero usage with identical persistence/counts. Restored screenshot inspected; observed q-to-exit plus captures 269/657ms. Broad runs are separate and may have loaded earlier package modules; no repository-wide pass claimed. No remote delivery or release performed.

## Distinguish cancellation from execution failure

Four task/phase marker regressions and eight paired dashboard/plain CLI cases failed before adding explicit cancelled completion metadata; additional setup/teardown AbortError cases validated their missing completion callbacks. Engine cancellation now emits cancelled: true with success false and no success credit. The CLI formats cancelled text and uses a status row instead of failure/error styling; normal failed execution remains unchanged. Removed the duplicate core completion DTO and wired the canonical package type through SDK/public exports.

All 359 maintained package plus SDK/CLI scope cases passed, selected maintained pipeline build closure and touched lint passed, and maintained lint:types passed after using the canonical DTO. Initial type checks identified the duplicate local DTO missing the new field; no successful type-check claim was made until corrected. Actual source CLI noisy-tool q confirmed cancelled task history fragment, exit 130/open task/zero credited work/no child/restored primary. Inspected restored screenshot; 159ms sample. Real-engine known/absent-usage cancellation repeated successfully; 532/273ms including captures. Broad gates and the thirty-minute stress run remain separate. No remote delivery or release performed.

## Release unobservable native stream history

GC-enabled direct native fake-agent run consumed and abandoned 60,004 events but retained approximately 11.2MB above baseline while its child stayed live. Source inspection confirmed native completed-history storage had no observer without configured middleware. Refactor keeps that history only for middleware consumers; unread event queues, usage/thread reducers, cancellation and default SDK full-session behavior are preserved. The same current run held approximately 0.47MB above baseline and aborted its owned child normally. These are exploratory scoped heap deltas, not a whole-CLI memory bound.

All 558 maintained agent-spawn cases passed on unchanged baseline and current sources, including middleware history and native OTLP cases. Initial baseline four native OTLP failures reproduced sandbox loopback EPERM; permitted rerun passed all cases before the refactor. Touched lint and selected maintained agent-spawn build closure passed. The longer CLI stress still retains full SDK session capture and remains separate. No remote delivery or release performed.

## Avoid full conversation retention in pipeline runners

Pipeline never observes the SDK's captured SessionResult. Added optional captureSession (default true) with CLI --no-capture-session parity; pipeline runners request false. Metadata capture preserves streaming, usage, thread IDs and existing log middleware while omitting completed event/message/tool history. Deferred ACP metadata regressions also validated that getters must observe stream consumption after child completion. Nine initial policy regressions and two deferred ACP cases failed before correction; all 1,134 affected package/SDK/CLI cases subsequently passed. Earlier overlapping-build runs reproduced transport timeout and native latency failures; settled serial scope passed unchanged assertions. Touched ESLint, permitted normal full build and maintained lint:types passed. Inspected maintained spawn help screenshot.

Alternating same-process source SDK runs consumed exactly 60,004 events per run using a verified isolated fake executable, three forced GCs before/after, and owned-child abort/cleanup. Full capture held additional heap of 15,947,816 / 15,404,168 / 13,594,984 bytes; metadata capture 270,048 / 203,544 / 228,432 bytes. These exploratory retained-heap samples are not whole-process memory bounds. Initial bundled QA drivers failed transient missing workspace export and bundle-relative provider discovery; final evidence uses actual source SDK plus normal template loader. Actual completed initialization plus three tasks retained 480/180/40 tokens, four child jobs, three done tasks/runs/steps, 10s and restored primary with exit zero. Thirty-minute TUI metadata stress remains separately monitored. No remote delivery or release performed.

## Reduce deep CJK history segmentation cost

Concrete source rendering benchmark (256 retained items of 16,384 basic CJK characters, 65x20 output pane) reproduced 17,879ms wall / 10,847ms CPU for an overlarge history jump. Three new regressions failed before allowing printable ASCII plus basic unified CJK to use independent code-unit boundaries and returning tab-free text unchanged from expandTabs. Combining marks, variation selectors, ZWJ, supplementary characters and controls still use Intl boundaries. Complete 20,992-character optimized-range comparison plus five mixed cases matched Intl.Segmenter. Same current benchmark measured 3,202ms wall / 1,572ms CPU for the jump; offsets and rendered geometry unchanged. Latest offset zero improved 79/77ms wall/CPU to 23/34ms; intermediate offset 197/115ms to 53/38ms. Exploratory samples under shared-machine load, not universal latency bounds; worst-case deep jump still exceeds interactive budget.

All 1,818 maintained design tests, touched ESLint and selected maintained design build closure passed. Maintained lint:types passed. Actual held Unicode terminal matrix passed 140x40, 100x24, 80x24, 50x16, 30x10 and 80x6; q exit 130/open tasks/owned children gone/restored primary, samples 198/78/65/54/68/65ms. Inspected narrow screenshot. Initial repeat used short completed Unicode fixture and raced normal completion before q; extended temporary fixture lifetime, without changing production behavior, for cancellation-specific checks. No remote delivery or release performed.

## Coalesce navigation repaints under deep history

A real source CLI burst of 100 PageUp keys then q initially exited in 517ms when consecutive messages shared one bounded preview. Extending the external fake with tool boundaries filled separate retained CJK message blocks and reproduced 2,855ms. A failing unit regression verified synchronous repaints occurred before quit handling. Navigation now accumulates row movement and uses the existing 16ms repaint timer; follow remains immediate and teardown cancels pending paint. All 1,819 maintained design tests, touched ESLint and selected maintained design build closure passed. Maintained deep-cjk fixture emits 512 separate 16,384-character blocks, allows an initial three-second PID capture window and holds the final turn for five minutes for cancellation QA.

Actual CLI against rebuilt design exports passed the same navigation burst in 272ms. Separate history/follow screenshot QA retained CJK blocks, followed to LATEST BURST RESULT and repeated burst-q in 235ms, exit 130/open task/owned child gone/primary restored. Both screenshots inspected; unavailable raster font glyphs remain boxes while terminal text remains Unicode. Early temporary/maintained drivers hit missing wrapper path, too-short marker waits or missed PID windows; corrected fixture timing and rebuilt exports were required before successful evidence. Benchmarks remain exploratory shared-machine samples, not latency guarantees. No remote delivery or release performed.

Broad changing-source npm test run finished unsuccessfully: 45 failed / 2,277 passed / 2 skipped files; 808 failed / 119,870 passed / 2 skipped cases. It loaded prior session/Unicode modules before tests changed, so current maintained npm test was refreshed after implementation stabilized. Attempt to stop its obsolete parent found no live child processes; no other process was terminated. A metadata TUI long stress run stopped on Wide frame mismatch after fixed-200ms resize sampling, without a failure screen. This is incomplete evidence, not a validated renderer defect or a thirty-minute pass. Fresh sixty-cycle stress now waits for exact requested frame widths and captures resize failures; all history/follow/persistence/cleanup assertions remain intact.


## Preserve streamed usage on aborted agents

Real native CLI cancellation after an observed 120/45/10 usage event returned zero totals. Eleven SDK/engine regressions failed before preserving captured usage on the original standard AbortError; independent event-stream and result-promise rejection paths are covered for CLI/ACP and full/metadata capture. Task/setup/teardown aggregation validates finite nonnegative usage and retains it once without interrupted success credit. Three additional failing initialization cases validated missing cancelled results after returned success plus signal cancellation, known-usage AbortError, and unknown-usage AbortError. A package factory now constructs that result; SDK wiring preserves the pre-aborted startup and ordinary failure behavior.

All 1,148 affected maintained agent-spawn/pipeline/SDK/CLI cases passed in the settled serial run, and touched ESLint passed. Maintained fake usage-before-cancellation emits usage while the native child remains alive. Actual source CLI task and empty-plan initialization cancellation both retained 120 input, 45 output and 10 cached, zero credited work, exit 130, owned child gone and restored primary; existing task remained open and empty plan remained empty. Restored screenshots /tmp/pipeline-streamed-usage-{task,init}-restored.png inspected. Samples including final raster capture were 568/545ms; they are not isolated input latency measurements. Build and final broad gates remain monitored separately. Initial lint:types during the build failed on temporarily absent agent-code-review declarations; rerun follows build completion.

## Completed metadata capture stress and protocol checks

Exact-frame-width thirty-two-minute noisy-tool repeat completed all sixty PageUp/held-output/compact-resize/follow/wide-resize cycles. Final q-to-exit 106ms, exit 130, task open, zero work/tokens, owned child gone and primary restored. Both /tmp/pipeline-tool-burst-metadata-frame-thirty-minute-{history,follow}.png inspected. Sixty RSS samples min/median/max 127,072 / 346,824 / 438,896 KiB; exploratory whole-process observations, not a memory bound or isolated causal comparison. Earlier fixed-delay failed sampling remains incomplete evidence.

Completed source SDK full/metadata capture had identical twenty streamed events, thread ID, 120/45/10 usage and log metadata; full retained seventeen messages and metadata zero. Actual CLI JSON variants produced the same protocolVersion 1 spawn_result, exit zero and no stderr; owned children gone. Rapid one-hundred alternating 30x10/100x24 resizes also restored primary with exit 130/open task/child gone; q sample 138ms. The broad lint run started before the last cancellation change finished exit zero with complete receipt; refreshed final checks remain separate. No push or release performed.

Normal maintained full npm run build completed exit zero after the streamed-abort and initialization changes, including workspace dependency closure, native postbuild checks, schema suffix stages and final bundle.

Settled maintained lint:types rerun passed exit zero, including root noEmit and SafeJS/tiny-mcp-client NodeNext/Bundler DOM and Node-only contract matrices.


## Final verification audit

The initial work list is implemented and verified: bounded viewport/history rendering; functional scroll/page/follow; coalesced paints and clean teardown; compact/narrow/short context; maintained synthetic, real-engine and native-external fake scenarios; settled real terminal screenshots; scoped tests, types, builds, design generation and atomic local commits. The source implementation remains unchanged during the final broad checks.

Latest affected scope, including corrected runtime help: 35 files / 1,152 cases passed. Unchanged design scope: 1,819 cases passed. Normal maintained full npm run build passed, including native checks, schema suffix stages and bundle. Settled standalone lint:types passed. Refreshed full npm run lint completed exit zero: ESLint receipt complete/exit zero, root TypeScript checks, SafeJS/tiny-mcp-client contract matrices and workflow lint all completed. Final maintained npm test finished exit one. Its shared phase reported 37 failed / 2,297 passed / 2 skipped files and 806 failed / 120,653 passed / 2 skipped cases in 2,419.70s. Thirty-six failed files and 805 failures were in safe-python; the remaining failure was the stale spawn-help snapshot corrected below. Subsequent declared unit stages did not establish a successful full route. No repository-wide unit pass is claimed, and concurrent safe-python changes were left untouched.

The preceding changing-source full test run was deliberately stopped after verifying its owned hierarchy (build-workspaces PID 20448, shared runner 22041). SIGTERM was sent only to that hierarchy; terminal exit one is cancellation, not a completed test result. A fresh maintained npm test started against committed pipeline sources. No implementation edits occurred during the fresh run; its validated stale spawn-help expectation was subsequently corrected in a separate snapshot change.

Additional real native checks passed: setup q retained 120/45/10 with zero work/open task; SIGTERM retained the same totals and restored primary; empty initialization without observed usage retained zero billing and an unchanged empty plan. Teardown q after a completed task returned 240/90/20, one completed run/task/step, no failed task, done persistence and child cleanup. Restored screenshots /tmp/pipeline-streamed-usage-{setup,sigterm,teardown}-restored.png and /tmp/pipeline-unknown-usage-init-restored.png inspected. Samples including raster capture 459/668/477/545ms, not isolated latency measurements. The first unknown-usage QA wait used the wrong fixture text and timed out; corrected marker repeat passed and process inspection found no remaining fake jobs.

Delivery remains local main commits only. No push performed, no verified remote-main delivery and no release publication claimed. Exploratory performance and memory samples remain observations: pathological deep jumps still take seconds, whole-process memory is not bounded by the dashboard preview policy, and missing raster font glyphs are separate from verified Unicode terminal cell geometry.


## Spawn help snapshot parity

Final maintained npm test exposed one owned help expectation still missing the new --no-capture-session flag. Isolated unchanged runtime-help suite reproduced one failure and three passes. Updated only the two expected help lines; generation run passed all four, followed by a normal assertion-mode expanded affected scope with all 1,152 cases / 35 files passing. No snapshot-update mode was used for that verification. Existing actual maintained spawn --help screenshot had already shown and verified this option; the correction changes expected output, not CLI behavior. The broad test run loaded the old expectation and remains a separate unsuccessful gate; no full-unit-pass claim follows from updating it.


Completion audit finished after more than eight tracked hours (30,053 seconds at final gate review). Maintained fake scenarios, real terminal screenshots, robustness changes, measured optimizations and local commits satisfy the initial TUI work list. Review artifacts are also available locally at screenshots/pipeline-tui-20260915-final-{wide,narrow}.png (ignored generated artifacts, not committed). Full lint/build and focused tests passed; full repository unit gate remains unsuccessful as recorded above. No push, verified remote-main delivery or verified release publication occurred.
