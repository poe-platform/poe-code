# Pipeline dashboard terminal QA

Run these steps with terminal-pilot against the fake output fixture at `packages/toolcraft-design/src/dashboard/testing/pipeline-scenario.ts`. This fixture exercises shared dashboard presentation and interactions; it does not prove pipeline SDK callback wiring or real cancellation.

## Setup

Launch a TerminalPilot session using the repository's `node_modules/.bin/tsx`, fixture path, and one scenario argument. Use the repository as cwd. Scenarios: `streaming`, `burst`, `failure`, `unicode`, `empty`. No credentials or network requests are needed.

Wait for expected visible text with `scope: "screen"` before evaluating each screen. After keypresses, wait for the repaint to settle before comparing screenshots. After resize, verify both requested size and rendered border positions; terminal dimensions alone do not prove that the redraw is correct.

## Interaction

1. At 100x24, streaming: wait for source file 199. Capture a PNG from screen.rawLines using terminal-png.
2. Press ArrowUp and verify the newest row leaves the viewport.
3. Press PageUp, wait for repaint, and record the visible screen. Wait longer than two output intervals; the history view must stay unchanged.
4. Press F and wait for Streaming response. Verify recent output becomes visible.
5. Press PageUp repeatedly beyond history and verify the oldest full page remains visible. PageDown must return toward recent output. End resumes live output.
6. Repeat with new output exceeding retention (unit regression covers 300 items); history must remain stable until follow is requested.
7. Resize while following and while viewing history: 140x40, 100x24, 80x24, 50x16, 30x10, and 80x6. Verify log wrapping, current action, metrics, footer, and complete terminal frame. Capture screenshots and inspect them visually.
8. Press q. Verify exit code 0 and terminal restoration. Repeat Ctrl+C and SIGTERM.

## Scenarios

- Failure: multiline error remains readable; failed stage is visible.
- Unicode: CJK, emoji, combining accents, tabs, colored ANSI, and carriage-return progress display correctly without corrupting borders.
- Empty: show an honest no-work state. Do not imply tasks are active or tokens were consumed by this run.
- Burst: navigate and quit promptly while 100 messages arrive every 100ms. Record render count, latency, and memory evidence separately from subjective appearance.
- Streaming: task/stage context remains accessible after configuration logs scroll out.

## Evidence so far (2026-09-14)

Five scenarios launched through real PTYs at 100x24 and resized to 50x16; all q exits returned 0. Streaming PageUp held identical screen text across 1.1 seconds of live output after repaint settled; F showed new streaming responses. PNGs in `/tmp/pipeline-{scenario}-{wide,narrow}.png`; history capture in `/tmp/pipeline-history.png`.

Inspection found clipped current actions and an overly wide sidebar at 50 columns. Right/bottom borders were missing in resized terminal-pilot screen captures; investigate renderer versus pilot resize behavior before declaring responsive layout verified. The empty fixture currently inherits fake running task/usage context and needs correction. Remaining sizes, cancellation, integrations, and quantitative burst performance are pending.

Short-height follow-up: terminal-pilot failure fixture now keeps failed task/stage visible through 80x10, 80x6, 50x10, 140x40, and 100x24 shrink/grow. Complete frames verified at every size; q exit 0. Visually inspected `/tmp/pipeline-context-80x6.png`. This validates the shared panel's height prioritization, not pipeline SDK execution or cancellation.

Additional scenario: `execution-error` represents an exception after task start, with error status and explicitly cleared current action. Real terminal-pilot capture `/tmp/pipeline-execution-error.png` showed no stale Current section; q exit 0. CLI regression independently drives task-start then a thrown SDK execution and verifies merged stats plus dashboard cleanup.

## Real engine with fake agent

Launch `tests/fixtures/pipeline-tui/engine-scenario.mts` through terminal-pilot using the repository tsx binary and cwd. The fixture runs the real workspace pipeline engine, uses memfs for plans/locks/logs, feeds engine callbacks into the current dashboard, and uses the actual shared quit-command handler. It does not invoke the root CLI's SDK wrapper or an external agent process.

Scenarios: `completed`, `failed`, `max_runs`, `nothing_to_run`, `cancelled`.

1. For terminal outcomes, wait for `Engine result: <scenario>` on the visible screen. Capture and inspect screenshots.
2. For `cancelled`, wait for `Fake agent streaming`, then press q while execution is awaiting more fake output.
3. Check exit codes: completed/max_runs/nothing_to_run = 0, failed = 1, cancelled = 130.
4. Inspect primary-screen output after exit. It reports actual persisted plan statuses with `TASK_STATUS` markers and actual `ENGINE_RESULT` / `ENGINE_RUNS` values.
5. Expected statuses for tasks 1–3: completed and nothing_to_run = done/done/done; failed = failed/open/open; max_runs = done/open/open; cancelled = open/open/open.
6. Repeat cancellation with SIGINT. Expect engine cancelled outcome, exit 130, all tasks open, and restored primary terminal.
7. Repeat with Control+c. This invokes immediate forceQuit via the actual shared handler. Expect exit 130 and restored primary terminal; no graceful engine result is required for immediate termination.
8. Completed/error outcomes intentionally stay on screen until q for review. q closes the fixture after the engine is terminal; it does not rewrite the completed engine result.

Executed 2026-09-14: all five scenarios matched outcome, exit code, and persisted statuses. SIGINT returned 130 and restored the screen; Ctrl+C returned 130 and restored the screen. Single observed samples: SIGINT 80ms and Ctrl+C 14ms including the capture work in that driver, so these are observational timings rather than calibrated input latencies. Captures `/tmp/pipeline-engine-{scenario}.png` and `/tmp/pipeline-engine-{SIGINT,Control-c}-restored.png`. Inspected completed and SIGINT-restored images visually. Maintained pipeline package tests: 233 passed; fixture ESLint passed.

Compact-width follow-up: five synthetic scenarios tested at 50x16 now use full-width logs plus persistent summary. Failure screenshot visually inspected: task/stage and readable error both fit. Repeated shrink/grow at 80x10, 80x6, 50x10, 140x40, and 100x24 kept frames and task context intact; q exit 0. Wide frames retain sidebar layout. Synthetic empty still needs its inherited usage/task illustration corrected.

Oversized scenario: launch synthetic fixture with `oversized`. Wait for LATEST RESULT on screen; capture. PageUp to oldest retained preview (30 presses in the executed 100x24 run) and verify Output truncated notice. Capture and inspect. F must show LATEST RESULT again; q exits 0. Executed successfully, marker screenshot inspected at `/tmp/pipeline-oversized-marker.png`. Store tests independently verify bounded text, preserved caller input, retention under 300 oversized messages, and surrogate boundary behavior. The preview intentionally omits older text inside an oversized event; it does not modify original caller output.

Newline-free scenario: launch synthetic fixture with `newline-free`. It feeds 1,000 large chunks through the actual shared line buffer before flushing. Repeat oversized latest/marker/follow checks. Executed successfully: LATEST RESULT visible, PageUp reached truncation notice, F resumed latest, q exit 0. Marker screenshot visually inspected. Root regression independently verifies CRLF after truncation and subsequent-line reset; full design and affected pipeline/experiment consumer checks passed.

Empty fixture corrected: regression reproduces inherited usage before the fix and now verifies zero tasks/tokens/elapsed plus no task execution log. Five-scenario PTY rerun passed at 100x24 and 50x16; empty captures inspected. The early wide image precedes deferred output repaint; settled narrow image includes All tasks are already complete and zero counters. Root CLI/external spawn integration remains pending.

Actual CLI SIGTERM regression: source CLI through root SDK and real external fake Codex child originally exited 143 with the dashboard still visible. After adding SIGTERM cancellation, two fresh isolated runs exited 130, left task open, stopped fake child, and restored the primary summary. Restored screenshot inspected. Use a fresh plan identity after immediate Ctrl+C: force quit can leave the pipeline run lock. Actual live capture showed raw JSON protocol duplication and delayed message presentation; both require follow-up fixes before declaring real streaming presentation verified.

Actual CLI protocol presentation fixed: adapter declaration suppresses raw protocol tee output; generic plain output still streams. Parameterized CLI regression covers both. Actual completed run screenshot /tmp/pipeline-cli-completed.png inspected: rendered agent/tool rows and no JSON record duplication. Correct done task and 120/45/10 tokens verified. This check uses a following tool event to flush the initial agent message; continuous delta presentation remains pending. Wrapped PID was not parsed, so do not claim new child-liveness evidence from this particular run.

## Actual CLI with external fake agent

Use `tests/fixtures/pipeline-tui/fake-codex.mjs` as the external application. It emits native Codex JSON events and exact 120/45/10 input/output/cached usage. It executes no tools and makes no network requests. Supported fixture environment: `PIPELINE_FAKE_SCENARIO` = completed (default), failed, cancelled, burst, unicode, oversized. Cancelled and burst keep streaming until terminated.

1. Create a fresh canonical `/private/tmp` workspace for every run, with bin, home, and repo/docs/plans directories. Fresh plan identities avoid a force-quit run lock contaminating the next experiment.
2. Create an executable shell wrapper named codex in its bin directory. It must exec the absolute Node binary with the absolute fixture path and forward literal "$@". Explicitly set mode 0755. Do not copy a nonexecutable .mjs directly onto PATH.
3. In that isolated session only, set HOME to the temporary home, prepend its bin directory to PATH, and set PIPELINE_FAKE_SCENARIO. Verify `command -v codex` resolves exactly to the wrapper. Leave the parent environment unchanged.
4. Create a Markdown plan through the YAML serializer with the declared schema `https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json`, kind pipeline, version 1, and an open task. Use three tasks for max-runs and task-progression checks.
5. Launch absolute repository tsx through terminal-pilot with `--import <repo>/scripts/register-template-loader.mjs <repo>/src/index.ts pipeline run docs/plans/fake.md --agent codex --model fake-model --tui --no-archive --yes`. Use the temporary repo as cwd.
6. Wait for PID= on the visible screen, parse and validate the child PID, then wait for response 5. This must become visible before the fake execution ends, without requiring another tool event. Capture and inspect screenshots; raw JSON records must be absent.
7. Completed: exit 0, persisted done, exact 120/45/10 token summary. Failed: exit 1, persisted failed. Cancellation by q, SIGINT, SIGTERM, or Control+c: exit 130, persisted open, primary terminal restored. Probe the validated child PID after exit; it must no longer exist.
8. Burst: wait for response 30, PageUp and settle, record only the log pane (elapsed stats legitimately change). After 1.1s the held log pane must remain identical. Resize 50x16, F, settle and inspect recent responses. q must cancel and restore the primary screen.
9. Use a completed plan to verify nothing_to_run without creating a child. With three open tasks and --max-runs 1, verify only the first task becomes done and final run limit is reported.

Executed live-preview follow-up: completed, failed, Unicode, SIGTERM cancellation, and burst matched expected exit/status, with valid child PIDs gone and primary screen restored. First text and response 5 were visible during execution. Burst held log area unchanged through 1.1s and resumed recent responses after narrow resize/F. Narrow burst screenshot inspected. Unicode PNG showed a border-alignment anomaly; distinguish terminal model from PNG renderer before claiming Unicode visual verification. A nonexecutable copied fixture once fell through to the installed agent and returned 401; that run is invalid evidence. The executable wrapper plus explicit resolution check replaced that setup.

Fresh live-preview q/SIGINT/Ctrl+C follow-up matched exit 130, open task, valid child PID gone, and primary-screen restoration. Alongside the prior SIGTERM run, all four actual CLI cancellation paths have now been observed with streaming previews. Full repository checks remain in progress; current safe-python failures prevent a broad-pass claim and do not establish a dashboard defect.

Unicode terminal-model diagnosis: /tmp/pipeline-live-unicode-screen.json shows all 24 lines exactly 100 display cells and sidebar/frame boundaries consistently at 66 and 99. Actual Unicode dashboard geometry is correct. The raster anomaly comes from terminal-png natural font advances for unavailable wide glyphs; its SVG renderer needs explicit terminal-cell placement. Keep PNG verification open until that tooling defect is fixed.

Raster placement fixed with five failing-before SVG regressions and 73 passing package tests. Re-rendered captured actual Unicode screen: /tmp/pipeline-unicode-fixed.png has aligned sidebar/outer borders throughout. Font placeholders remain for unsupported glyphs; cell placement and underlying Unicode text are verified separately. Forced design-doc generation completed; regenerated dashboard example inspected.

Actual CLI limit/progression/no-work checks executed: three tasks completed with three tracked child jobs and 360/135/30 token summary; max-runs 1 completed only task one, with one child job and 120/45/10 tokens; no-work plan preserved all done statuses, created zero child jobs and showed zero usage. All exit 0 with primary-screen restoration. Capture names /tmp/pipeline-limits-{progression,max_runs,nothing_to_run}-{live,restored}.png (no live capture for immediate no-work outcome).

### Same-plan restart after force quit

Launch the actual CLI with the executable isolated fake agent in cancelled mode. Wait for live response 5, capture the child PID, and press terminal-pilot Control+C. Verify exit 130, child termination, open persisted task, and restored primary screen. Immediately launch the same plan with the completed fake scenario; verify it starts without a lock timeout and finishes done/exit 0. Capture and inspect the retry screen. Verified locally: active retry in 1,028ms. SIGKILL/crash recovery remains outside this result.

### Live lock contention

Use the same canonical isolated plan path for two actual CLI sessions. Keep the first fake agent running in cancelled mode. Launch a second session; verify selected agent/model/plan and Waiting for another run, with zero work/usage. Capture at 100x24 and resize to 50x16, then inspect both. Press q in the waiter: verify exit 130 and that the first session's parsed child PID remains alive. Quit the owner and verify its child stops. In a separate run, use completed mode for the waiter, quit the owner while the waiter is blocked, and verify the waiter resumes, replaces the wait action with its task title, completes done/exit 0, and restores the primary terminal. Verified locally: waiting cancellation 21ms; resumed completion 1,677ms.

### Redundant protocol capture measurement

Exercise runPoeCommand with an in-memory fake execution environment yielding 1,024 distinct 65,536-byte stdout buffers and retained stderr diagnostics. Count stdout callback bytes without retaining them. Compare separate GC-enabled Node processes using default capture and captureStdout=false; materialize the returned stdout before GC, then record retained bytes, heap delta, RSS delta, and elapsed time. Verify 67,108,864 bytes delivered in both and stderr preserved; selective capture returns empty stdout. Observed retained heap: 67,310,864 versus 202,616 bytes. Treat RSS as allocator-dependent and do not infer a process-wide bound. Repeat actual external-agent completed/failed CLI scenarios to confirm event delivery and diagnostics.

### Tiny terminal recovery

Launch the maintained Unicode/ANSI fixture at 100x24, then resize successively to 40x10, 20x6, 10x5, 5x3, 2x2, and 1x1. Capture and inspect each terminal screen. Expect whole q Quit at ten columns, q at five, intact borders wherever geometry permits, and no crash at one cell. Resize back to 100x24 and verify the full Unicode/ANSI frame recovers, including normalized carriage-return progress and tab columns. Press q and verify exit 0/restored primary screen. Verified locally after footer fix; unsupported font glyphs still use placeholders in raster screenshots.

### Session aggregation and sustained live history

Feed sessionCapture 8,000 fake text events of 280 characters each, consuming its wrapped stream. Verify live first-message output, unchanged complete messages, final output length 2,247,999, and elapsed time comfortably within one second. Local measured improvement: 2,231ms to 10ms. Then launch actual CLI with external fake burst mode, hold PageUp history for twenty seconds, verify held log area stays unchanged, resize to 50x16, press F, inspect a current-response screenshot, and quit. Verify exit 130, open task, zero completed usage, stopped child, and primary-screen restoration. Avoid treating the tsx launcher RSS alone as whole-process memory.

### Setup, task steps, and teardown

Create an isolated pipeline plan with setup/teardown prompts, one task work titled Improve fake pipeline output, and status keys implement/review both open. Define those steps in the isolated default.yaml with mode yolo and prompts Implement: {{prompt}} / Review: {{prompt}}. Use the executable external fake in completed mode. Capture setup, step 1/2, step 2/2, and teardown screens while each execution runs. Verify current phase/action and task counter: zero during setup/intermediate implement/review start, one once review completes and teardown begins. Implement completion must identify the step rather than claim the whole task is done. Verify final persisted steps done, finalization completed, four tracked child jobs, two runs, one completed task, four completed steps, exact 480/180/40 usage, exit zero, and restored primary terminal. Inspect the images for stray prefix/partial rows as well as status correctness. Validated locally; stray rows remain a separate diagnostic follow-up.

Usage events should occupy only their actual token line and any necessary wrapped continuation; no separate timestamp/stage-only separator row should precede them. Keep paragraph breaks inside agent messages. Validated adapter regression and actual phase screenshot after separator cleanup.

### Failures in phases and retry

Use an isolated executable wrapper to number fake-agent invocations; select failed mode only for invocation 1 (setup), 3 (review) or 4 (teardown), and completed mode otherwise. Execute the same setup/two-step/teardown plan. Verify exit 1/restored terminal; failure message names setup, work (review), or teardown. Completed-step counts must be 0, 2, or 3 respectively. Setup leaves task steps open; review leaves implement done/review failed and finalization pending; teardown leaves both done/finalization pending. These failure outcomes were executed and screenshots inspected. Rerun the same plan after the one-shot failure and verify eventual completion/finalization, no unnecessary reexecution of already completed task steps, and accurate per-run usage. Retries validated locally: setup adds four successful jobs (two task runs, four completed steps, 480/180/40 usage); review adds setup/review/teardown only (one task run, three steps, 360/135/30); teardown adds only teardown (zero task runs, one step, 120/45/10). All retries exit zero with finalization completed and restored primary screens.

### Finite native protocol burst

Use an isolated external fake that publishes PID, pauses briefly, emits 60,000 numbered agent-message events and LATEST BURST RESULT, then holds before its successful usage/completion event. Verify eventual latest marker, capture the settled dashboard, and verify exit zero/restored terminal/done task with 120/45/10 usage. Hold completion long enough to distinguish consumer delay from a fleeting final dashboard frame. The maintained unit regression verifies all 60,000 message events in order and processing within one second; direct queue timing alone does not establish CLI latency or whole-process memory bounds. Initial five-second hold observation was insufficient and cleanup interrupted the run; extended thirty-second hold passed: latest marker at 14,693ms, exit zero, done task, correct 120/45/10 usage and restored terminal. Latest-result screenshot inspected. This exposes substantial remaining downstream consumer cost.

For preview aggregation performance, consume 60,000 numbered text deltas through the dashboard adapter without disk logging and verify first live text, a single updated final preview, truncation notice and latest marker within one second. Separately measure logging/session capture and the actual CLI burst; do not infer real CLI latency from the synchronous isolated adapter. Current isolated aggregation is 65ms; actual CLI latest marker is 13,394ms, still a substantial downstream delay. Bounded chunk previews must preserve paragraph breaks and oversized Unicode tails.

Generated UUID run-log size tracking: verify every yielded event is already present on disk, including UTF-8 text; after a simulated partial append failure, the log must retain exactly the preceding successful event bytes. Explicit/session-named paths retain fresh file-size checks. Maintained memfs regressions cover these behaviors. Same-process sixty-thousand-event real-disk comparison measured 1,676ms with fresh checks versus 910ms tracked. Extended ninety-second fake hold completed correctly, marker at 6,230ms; total ninety-one-second duration includes the hold. A preceding twenty-five-second marker timeout remains failed QA evidence, not a successful run.

### Unicode cursor accounting and adversarial terminal strings

Run maintained presentation fixture cursor-controls. At 100x24 verify A 界 after CJK carriage-return overwrite, a blank cell before X after emoji and ZWJ backspace, X after combining-accent backspace, and X       B after tab overwrite. OSC/DCS HIDDEN_ payloads must not be visible; unsupported clear/cursor sequences must preserve the dashboard frame and Frame preserved text. Resize 50x16 -> 30x10 -> 100x24, inspect screenshots and press q for exit zero/restoration. Executed locally with independent raw PTY reference producing the same cursor results. This fixture covers shared presentation, not root pipeline SDK or agent execution.

The cursor-controls fixture now also covers DEL and C1 sequences. Verify leftright after DEL, C1 frame preserved after a C1 clear command, Visible C1 OSC result after OSC/ST, and Visible C1 DCS result after DCS containing BEL and then ST. HIDDEN_ payloads must remain absent throughout. At 30x10 press PageUp to earlier output, inspect its screenshot, and press F to return to the latest fixture text. Executed locally at wide/narrow/short sizes, screenshots inspected and q exited zero; 1,765 design tests passed. OSC accepts BEL termination; DCS/SOS/PM/APC require ST.

### Held event consumer and cancellation backlog

In unit coverage, hold the native event iterator until producer completion, then consume 100,000 numbered events; verify all in order and drain within 500ms. Mock protocol conversion to isolate queued delivery rather than external processes. Real QA: emit a finite dense native burst, hold completion, wait for visible Burst response and press q before consumption catches up. Verify open task, no child, cancelled summary/restored terminal and exit 130. Measure q-to-process-exit separately from summary duration and compare child exited_at with log modification time. Current real sample exited correctly but took 44,265ms; queued log writes continued roughly 43 seconds after child exit. Presentation-consumer cancellation is pending and this is failed responsiveness evidence.

After building the selected agent-spawn closure, repeat cancellation so the source CLI loads the new package output. Verified follow-up: 311ms q-to-exit, child gone/open task/zero usage/exit 130/restored terminal; job exit and final log write occurred in the same second. Unit cancellation must close the generator, consume at most the event already in flight, publish no buffered text/error and leave no timer writes. Retry the same cancelled plan with the maintained completed external fake and verify done task/exit zero/120 input,45 output,10 cached usage/restoration. This retry passed locally with screenshots inspected. A QA run started while the package was rebuilding loaded the old output and took 24,461ms; do not count it as validation of the fix.

Native middleware early-close regression must verify a consumer break executes the middleware generator's finally block, while the independent child result still completes successfully. Maintained suite passed 555 tests after replacing the forwarding iterator with async-generator delegation. Rebuilt dense CLI cancellation repeated at 251ms with the same cleanup/status/usage/restoration checks and inspected screenshot.

Raw native delivery closure must drop buffered events and resolve a pending next() as done. Verify the independent producer still completes, context transcript includes events arriving after closure and token usage remains accurate. These three regressions passed in the 558-test maintained agent-spawn suite; actual rebuilt dense cancellation repeated at 179ms with the same status/child/usage/restoration checks and inspected screenshot. Presentation delivery disposal must not truncate the producer transcript.
