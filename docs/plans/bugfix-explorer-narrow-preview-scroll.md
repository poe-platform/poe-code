# Explorer narrow preview scrolling bugfix

## Scope

- In the 60–79-column layout, Tab exposes a focused preview using the full body height. The reducer must use that visible height for line, page, half-page, and maximum scroll calculations.
- Keep detail height zero for too-narrow terminals or the hidden narrow preview while the list is focused. Preserve vertical and side-by-side layout calculations, list navigation, and resize clamping.
- Change only the height guard in `reducer.ts`, focused reducer regressions, an actual detail-renderer regression, and this plan. No renderer production imports, abstractions, Markdown wrapping changes, dependencies, inline comments, README edits, staging, commits, or pushes.

## Execution

1. Reproduce scrolling failures with actual initial state, parsed terminal key bytes, and reducer events before production edits.
2. Cover 60/70/79 columns, line/page/half-page movement in both directions, repeated-page bounds, focused resize retention, hidden layouts, and existing 80/99/100/120-column behavior.
3. Verify the actual renderer displays lines 17–24 after scrolling a 24-line preview to its final eight-line page.
4. Apply the minimal focused-preview exception to the existing height guard.
5. Run focused and package tests, lint, and type checks; report source stability to the parent.

## QA

- Parent captured and inspected `screenshots/ux-explorer-narrow-preview-before.png` using the actual reducer and rendering. Independent confirmation also exercised parsed terminal key bytes. The preview is visible but its scroll remains zero.
- Parent owns after-QA, screenshots, review, and publication after the preceding release.
- Unit fixtures use in-memory short newline-separated text and screen buffers. No subprocesses, filesystem fixtures, network, or LLM calls.
- Preserve unrelated manifests, security plan, terminal assets, and all disjoint work.

## Results

- Red before production edits: the new narrow reducer tests and existing detail-renderer suite reported six failures and 14 passing controls. Failures reproduced zero scroll at 60/70/79 columns, repeated-page failure, loss of scroll 8 on a focused 100-to-70-column resize, and failure to reach the rendered final page.
- Production changes exactly one guard in `detailBodyHeight`: too-narrow layouts remain disabled; narrow-list-only remains disabled only when detail is not focused. Focused narrow previews reuse the existing full-body height calculation.
- Added 15 tests: 14 focused reducer cases and one actual renderer case. At 70×14, Down moves one line, PageDown eight, Ctrl+D four, and repeated pages clamp at 16; reverse keys and lower bounds are checked. The renderer displays exactly lines 17–24 on the final page.
- Controls preserve zero scroll below 60 columns or eight rows, the hidden list-focused preview, page height three at 80/99 columns, page height eight at 100/120 columns, and list-focused navigation. Parsed terminal key bytes drive all keyboard regressions.
- Focused green: `node_modules/.bin/vitest run packages/toolcraft-design/src/explorer/reducer-narrow.test.ts packages/toolcraft-design/src/explorer/render/detail.test.ts packages/toolcraft-design/src/explorer/reducer.test.ts packages/toolcraft-design/src/explorer/reducer.overhaul.test.ts packages/toolcraft-design/src/explorer/layout.test.ts --reporter=dot` passes all 40 tests, with 45 ms test execution.
- Full-package green: `npm run test --workspace=toolcraft-design -- --reporter=dot` passes 1,638 tests across 78 files, up from 1,623 tests. Test execution took 2.80 seconds; total duration was 6.55 seconds.
- `npm run lint --workspace=toolcraft-design` passes package ESLint and TypeScript checking. Direct strict ES2022/NodeNext checking of `reducer-narrow.test.ts`, `render/detail.test.ts`, and their imports passes. `git diff --check` passes.
- Source is stable and green for parent after-QA and publication coordination. No baseline screenshot was recreated; no commits, pushes, staging, dependencies, README edits, comments, or unrelated changes were made.

## Parent terminal QA

- Ran the actual public `runExplorer` with the real terminal driver inside a
  70-column, 14-row PTY. The in-memory row supplied 24 short preview lines.
- Sent Tab and two PageDown key sequences through the PTY. The captured terminal
  displayed lines 17–24 and no longer displayed line 01.
- One Ctrl+C resolved the explorer normally and restored terminal modes.
- Captured the actual terminal screen before alternate-screen teardown and
  inspected `screenshots/ux-explorer-narrow-preview-tty-after.png`. This is ad hoc
  terminal QA, not a persisted script or screenshot test.
