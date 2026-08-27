# Explorer wrapped preview scrolling bugfix

## Scope

- Align keyboard bounds, rendered body rows, and progress with one shared callback-free Markdown preparation cache using the actual pane body width.
- Reuse `computeExplorerLayout` and move the pure `paneBodyRect` geometry into the layout layer. Retain the existing pane export as a re-export, not a proxy function.
- Preserve existing Markdown preparation, trimming, cache keys/policy, ANSI-aware cell rows, item-list bounds, loading behavior, and progress formatting. Do not audit or redesign hashing/cache policy in this fix.
- The reducer only prepares stored `renderedContent`; missing or unresolved content never invokes user callbacks. Runtime remains responsible for invoking content callbacks and delivering replacements.
- No dependencies, README edits, inline comments, staging, commits, pushes, or unrelated changes. Owned source and tests stay under `packages/toolcraft-design/src/explorer`; this plan stays in `docs/plans`.

## Execution

1. Add red actual-key reducer/render/runtime regressions for wrapped content, Markdown physical rows, trailing blanks, width changes, and asynchronous replacement.
2. Add shared preparation/cache and geometry compatibility tests, plus narrow import-boundary allowances and rejection controls.
3. Extract existing preparation/cache into the callback-free content layer and share its physical rows with rendering and bounds.
4. Derive body dimensions from the same layout functions rather than duplicating breakpoints or insets.
5. Run focused and package tests, lint, and strict type checks; record results and hand off parent QA.

## QA

- Parent captured and inspected `screenshots/ux-explorer-wrapped-preview-before.png`. A one-paragraph wrapped preview is visibly scrollable but keyboard offsets remain zero; raw Markdown and trailing blanks also produce incorrect bounds.
- Parent owns after-QA, screenshots, review, commits, and publication. Finish correctness and verification even if the goal window ends.
- Unit tests use memory-only state, terminal drivers, screen buffers, and deterministic event-loop flushing. No subprocesses, filesystem fixtures, network, or LLM calls.
- Preserve unrelated manifests, security plan, terminal assets, and all disjoint changes.

## Results

- Final red run before production edits: 16 failing tests and 28 passing controls, plus the shared-content suite could not load its not-yet-created module. Failures covered actual wrapped keyboard/runtime behavior, Markdown/trailing-blank bounds, resize/replacement, cache-backed navigation, and missing geometry/import allowances. An initial list control incorrectly expected page navigation to alter item scroll; it was corrected before production edits to exercise the established resize clamp instead.
- Added 29 tests: 19 wrapped reducer/render regressions, seven shared preparation tests, one actual runtime test, one geometry/re-export test, and one explicit import-boundary test.
- `detail-content.ts` contains the extracted Markdown preparation/cache and ANSI-aware physical cell rows. Hashing, width normalization, trimming, and cache keys/policy remain unchanged. Both renderer and reducer use the same cached prepared result.
- `paneBodyRect` now belongs to `layout.ts`; `render/pane.ts` re-exports the exact function. Reducer page height and maximum scroll use the actual computed layout/body dimensions; no copied breakpoints or inset arithmetic remain in those calculations.
- Renderer callbacks remain confined to the existing rendering/runtime paths. Missing/unresolved reducer content returns zero bounds without invoking callbacks. List bounds remain item-index based. No runtime production code or state fields changed.
- Keyboard tests verify maxima 16 at 60/70/79/100/120 columns, 21 at 80/99, and four at 200, with actual rendered bottom rows and 100% progress. They cover both directions, pages, half-pages, a 17-source-line Markdown document producing 29 physical rows, and immediate reverse movement after trimmed trailing blanks.
- Width growth clamps scroll to the new physical maximum; shrinking preserves valid offsets. An asynchronous content replacement recomputes bounds from the stored replacement. Cache tests prove one Markdown render for initial paint plus keys, one additional render for a new width, and reuse when revisiting the original width.
- Actual `runExplorer` with the existing memory terminal driver reaches 50% and 100% using terminal key events, stays at the correct bottom after resize, invokes the user content callback once, and exits through the existing cleanup path.
- Focused green: `node_modules/.bin/vitest run packages/toolcraft-design/src/explorer/reducer-wrapped.test.ts packages/toolcraft-design/src/explorer/runtime.test.ts packages/toolcraft-design/src/explorer/imports.test.ts packages/toolcraft-design/src/explorer/detail-content.test.ts packages/toolcraft-design/src/explorer/layout.test.ts packages/toolcraft-design/src/explorer/render/detail.test.ts packages/toolcraft-design/src/explorer/render/detail-scroll.test.ts packages/toolcraft-design/src/explorer/reducer-narrow.test.ts --reporter=dot` passes all 93 tests, with 585 ms test execution.
- Full-package green: `npm run test --workspace=toolcraft-design -- --reporter=dot` passes 1,689 tests across 81 files, up from 1,660 tests. Test execution took 2.75 seconds; total duration was 6.49 seconds.
- `npm run lint --workspace=toolcraft-design` passes package ESLint and TypeScript checking. Direct strict ES2022/NodeNext checking passes for the new shared-content and wrapped reducer tests, changed layout/import tests, and their imports. `git diff --check` passes.
- Standalone strict checking of `runtime.test.ts` reports TS18048 in its unchanged `screen()` helper: a terminal-buffer line may be undefined. An in-memory TypeScript compiler-host comparison confirms the same sole diagnostic in HEAD at line 207 and the working file at line 236. No new diagnostics were introduced, and this unrelated helper was not changed.
- `npm run build --workspace=toolcraft-design` passes the guarded package build and postbuild export smoke checks. Generated output remains ignored; no additional tracked paths changed.
- Parent reviewed the production diff and passed actual public `runExplorer` QA in a real 70×14 PTY: a single raw paragraph of 24 words, Tab, and two PageDown presses display words 17–24 at 100%. The content callback runs exactly once; one Ctrl+C resolves null and restores the terminal.
- Parent captured and inspected `screenshots/ux-explorer-wrapped-preview-tty-after.png` against the before evidence. The agent did not duplicate the ad hoc probe.
- Parent independently verified 24 combinations of three content forms and eight terminal widths against physical rows prepared directly with the existing Markdown renderer and ANSI cell parser. Maximum offsets, exact visible bottom rows, 100% progress, immediate reverse movement, and zero reducer callback invocations all pass. Three resize transitions also pass, including hidden content clamping to zero. Parent captured and inspected `screenshots/ux-explorer-wrapped-preview-after.png`.
- Source is stable for parent review, commit, and release coordination. The search window has ended; no further candidates were investigated. No staging, commits, pushes, dependencies, inline comments, README edits, baseline recreation, or unrelated modifications were made.

## Changed Paths

- `packages/toolcraft-design/src/explorer/detail-content.ts`
- `packages/toolcraft-design/src/explorer/detail-content.test.ts`
- `packages/toolcraft-design/src/explorer/reducer.ts`
- `packages/toolcraft-design/src/explorer/reducer-wrapped.test.ts`
- `packages/toolcraft-design/src/explorer/layout.ts`
- `packages/toolcraft-design/src/explorer/layout.test.ts`
- `packages/toolcraft-design/src/explorer/render/detail.ts`
- `packages/toolcraft-design/src/explorer/render/pane.ts`
- `packages/toolcraft-design/src/explorer/runtime.test.ts`
- `packages/toolcraft-design/src/explorer/imports.test.ts`
- `docs/plans/bugfix-explorer-wrapped-preview-scroll.md`
