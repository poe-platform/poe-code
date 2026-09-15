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
