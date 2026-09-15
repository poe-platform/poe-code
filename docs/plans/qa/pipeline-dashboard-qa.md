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
