# Shared TUI primitives

Implement eight primitives in toolcraft-design: scrollable viewport, collapsible event groups, task tree, progress group, command registry, overlay/focus manager, metrics/sparklines, and inline notices. No diff viewer. Reuse existing terminal, screen, theme and explorer behavior. Keep harness business decisions in consumers. No README additions or push requested.

Performance is part of acceptance: visit/render visible rows only, index key dispatch, coalesce updates, bound history/diagnostic samples, preserve immediate cancellation and clean teardown. Add a measurable frame monitor and live diagnostics: repaint dispatch FPS, render duration percentiles, input-to-flush latency, coalesced requests changed cells and cumulative slow frames. Idle FPS may be zero. Terminal pixel presentation cannot be measured from stdout; distinguish dispatch from presentation and backpressure.

Each atomic primitive gets failing regression coverage, implementation, public exports, narrow maintained checks and its own commit. Validate all visual primitives with real terminal-pilot screenshots at wide/narrow/short sizes and light/dark themes. Maintain QA as Markdown; any executable fixture is the fake application under test.

Completion: public API/examples in design docs, representative integration in dashboard/explorer, burst/input/resize performance measurements, maintained package test/lint/build, design generation, appropriate broad gates, committed own files. Ignore concurrent changes. Report local commits, remote delivery and release separately.

## Public configuration and semantics

No new environment variables. Existing POE_CODE_THEME controls terminal styling.

- createViewport({ capacity }): keyed retention, immutable held item sequence, row offset, unseen update count, predicate search and follow. selectViewportTail(items, height, offset, renderRows) wraps only the required tail items and clamps oversized row offsets while retaining at most one screen of rows.
- createEventGroups({ capacity, children }): bounded group/child counts; previews use the existing 16,384-character terminal output limit. Errors expand their group. rows(offset, height) emits visible headers/children; renderEventGroupRows(rows, width) clips by terminal cells.
- createTaskTree({ capacity = 10000 }): indexed parent hierarchy; cycles and capacity overflow throw. Children wait for their parent to arrive. remove(id) removes a subtree. rows(offset, height) traverses iterators without materializing all roots; renderTaskRows(rows, width) includes status and optional durationMs. Callers own selection/navigation and task lifecycle.
- renderProgressGroup(items, width): each item has label, optional completed/total and running/success/error status. Only finite positive totals with known completed values produce percentages, clamped to 0–100; unknown work uses an ellipsis.
- createCommandRegistry(commands): id, label, keys, run and optional enabled predicate. Duplicate IDs/bindings throw; disabled commands disappear from discovery and cannot dispatch. One declaration supplies help/palette data through list(), with indexed key dispatch.
- createOverlayManager(initialFocus): stack focus with AbortSignal per open; close aborts the top overlay and restores the previous focus; dispose aborts all overlays. Bind Escape to close; no overlay takes focus implicitly.
- createMetric({ capacity, unit }): bounded circular samples; non-finite/null values render as unknown, with a gap in the sparkline. render(width) clips by terminal cells.
- createNotices({ capacity, now? }): keyed replacement, dismiss and optional durationMs per put. Expiration is evaluated on reads and does not create idle repaint timers. renderNotice({ level, text }, width) provides a fitted semantic marker.
- createRenderPerformanceMonitor({ now?, sampleSize = 256 }): sampleSize accepts 1–4096. request(kind), begin(), end(start, { changedCells }) collect repaint dispatch FPS, sampled paint/input percentiles and cumulative slowFrames/longestRenderMs. Dashboard exposes getPerformance(), optional onPerformance and Ctrl+G diagnostics. Same-status stats bursts coalesce; status transitions remain immediate. Input latency begins when the app handles the key and ends at flush enqueue.

## Verification record

TDD covered each primitive and validated same-status stats repaint storms and the terminal-pilot zero-red RGB parser bug. Focused design-system checks passed (98 files, 1,847 cases at this checkpoint), and terminal-pilot passed all 293 cases. The maintained full build passed including root suffix stages. Generated terminal/markdown/JSON design docs include the new primitives example.

Real PTY QA exercised dark/light themes, 100x24, 50x16 and 30x10 layouts, collapse controls, nested overlays, Escape, history hold/follow, resize, diagnostics and quit. Light raster QA explicitly substitutes white/default text colors because terminal-png's default canvas is dark; explicit SGR colors are preserved. No screenshot tests were added.

The initial burst runs showed 610–674ms stalls. Validated observer effect: terminal-pilot reads the PTY in the same process where synchronous PNG rasterization runs; rasterizing during the session stops reads and can block the application's TTY writes. Corrected QA captures terminal text during interaction and rasterizes only after exit. Do not use rasterization-time samples to assess application rendering.

Corrected 100-update/16ms burst, while repository tests continued: dark 55,006 requests / 546 paints / 54,460 merged; paint p50 1.96ms / p95 2.60ms, cumulative longest 15.33ms, zero paints over 16.67ms, input p95 7.87ms, quit 7ms. Light 50,506 requests / 501 paints / 49,905 merged; paint p50 3.78ms / p95 4.56ms, cumulative longest 29.92ms, 3 paints over 16.67ms, input p95 17.55ms, quit 11ms. Both exited zero. Final rolling repaint rates were 49 and 47 FPS. These measure dispatch under fake streaming/resize/input activity, not terminal pixel presentation or universal performance guarantees.

Full repository lint passed: ESLint (zero errors/warnings), root types, SafeJS/tiny-mcp-client type contracts and workflow lint. Full maintained unit route was rerun with the required socket access. It recorded 972 safe-python failure records while that area was concurrently changing, plus one superintendent timeout and three primitive safety failures from modules loaded before the final fixes. Fresh checks passed both superintendent cases (188ms) and all 1,850 design-system cases. The stale full run was stopped after recording those failures; it is not a passing full-suite gate. No safe-python files were modified by this task.

Delivery: all eight primitives, dashboard viewport integration, render diagnostics and stats coalescing, public exports, interactive fixture, generated examples and QA evidence are committed locally on main. Final focused unit checks: 98 files / 1,850 cases; demo/documentation checks: 17 cases; terminal-pilot: 293 cases. Focused lint/build and full build/lint passed. No push, remote-main verification or release was requested or performed.
