# Explorer scroll indicator bugfix

## Scope

- Derive detail progress from the same clamped start and maximum used to render the body, not raw selected-item source line counts or unclamped state.
- Blob progress uses rendered physical line count minus body height. List progress uses item count minus one and is independent of the selected item's cursor or content length.
- Preserve zero progress without a scrollable range and the loading spinner even when stale content remains visible.
- Render the body once, return its calculated bounds, then draw the border-only frame with the indicator. Do not invoke user render callbacks again, add state fields, import the renderer into the reducer, or change Markdown rendering or keyboard scrollability.
- Own only `render/detail.ts`, focused detail renderer tests, and this plan. No dependencies, inline comments, README edits, staging, commits, pushes, or unrelated edits.

## Execution

1. Add red tests for top/middle/bottom progress, stale bounds, fit/empty/loading states, and list cursor independence.
2. Cover trimmed trailing blanks, rendered Markdown, fifteen wrapped physical rows, and an uncached synchronous callback invoked once.
3. Return existing body-render bounds and use them to format the frame indicator without another render pass.
4. Preserve the existing narrow-preview regression and run focused/package tests, lint, and type checks.
5. Record evidence and notify the parent when the source is stable.

## QA

- Parent captured and inspected `screenshots/ux-explorer-scroll-indicator-before.png`: 24 lines in an eight-line body show 0%/35%/70% at scroll 0/8/16 instead of 0%/50%/100%.
- Parent owns after-QA, screenshots, review, commits, and publication. The preceding narrow-preview fix remains intact.
- Tests use in-memory state, content, and screen buffers. Wrapped-content tests supply renderer offsets directly and do not assert keyboard reachability.
- Preserve unrelated manifests, security plan, terminal assets, and all disjoint work.

## Results

- Red before production edits: the new indicator suite plus existing detail-renderer tests reported 16 failures and 12 passing controls. Failures reproduced incorrect percentages for middle/bottom positions, stale negative and fit/empty offsets, cursor-dependent list progress, and raw-versus-rendered content lengths.
- Added 22 in-memory renderer tests in `render/detail-scroll.test.ts`. Existing `detail.test.ts`, snapshots, and narrow-preview reducer regressions remain unchanged.
- Blob and list rendering now return their already-calculated clamped start and maximum. The common rendering flow draws the body once, then the border-only frame. The duplicate narrow-vertical branch was identical and is removed to share that flow. The existing formatter uses the returned bounds and still prioritizes the loading spinner.
- Tests verify 0%/50%/100% for the 24-line, eight-row body; stale clamping without state mutation; zero progress for fitting/blank/empty/absent content; loading with and without stale visible content; item-index progress independent of cursor; trailing blank trimming; Markdown physical rows; and 43% at scroll three in fifteen wrapped rows with an eight-row body.
- The uncached synchronous render callback is invoked exactly once while supplying both body content and correct progress. No extra render pass or user callback invocation was added.
- Focused green: `node_modules/.bin/vitest run packages/toolcraft-design/src/explorer/render/detail-scroll.test.ts packages/toolcraft-design/src/explorer/render/detail.test.ts packages/toolcraft-design/src/explorer/reducer-narrow.test.ts --reporter=dot` passes 42 tests, with 87 ms test execution.
- Full-package green: `npm run test --workspace=toolcraft-design -- --reporter=dot` passes 1,660 tests across 79 files, up from 1,638 tests. Test execution took 2.57 seconds; total duration was 6.14 seconds.
- `npm run lint --workspace=toolcraft-design` passes package ESLint and TypeScript checking. Direct strict ES2022/NodeNext checking of both detail renderer test files and their imports passes. `git diff --check` passes.
- Source is stable and green for parent after-QA and review. Parent after screenshots remain pending at handoff. No staging, commits, pushes, dependencies, inline comments, README edits, or unrelated modifications were made.

## Parent verification

- Rendered top, middle, and bottom into actual screen buffers and asserted
  0%/50%/100%, the exact eight visible content lines, and unchanged state scroll.
  Captured and inspected `screenshots/ux-explorer-scroll-indicator-after.png`
  against the before image.
- Ran the public `runExplorer` with the real driver in a 70-column, 14-row PTY.
  Tab and two PageDown sequences reached lines 17–24 with a 100% indicator.
  One Ctrl+C resolved normally and restored terminal modes.
- Captured the terminal before alternate-screen teardown and inspected
  `screenshots/ux-explorer-scroll-indicator-tty-after.png`. No persisted QA script
  or screenshot test was added.
- Reviewed the shared body/frame flow: the body supplies its existing clamped
  range, the frame writes only borders, and no additional callback or render pass
  is introduced. The preceding narrow-scroll fix remains a separate commit.
