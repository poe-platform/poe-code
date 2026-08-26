# Explorer Unicode filter bugfix

## Scope

- Match fuzzy subsequences as whole Unicode code points, never as surrogate fragments borrowed from separate characters or fields.
- Preserve the public UTF-16 position spans consumed by the renderer: an emoji includes both offsets, and subsequent title/subtitle offsets retain their existing meaning.
- Preserve ASCII/BMP scoring constants, UTF-16 early-match offsets, score/position tie-breaking, case conversion, ANSI stripping, field joining, and empty-query behavior. Consecutive bonuses apply across adjacent whole code points.
- This is not grapheme-atomic matching or normalization. Code-point subsequences may match within combining or ZWJ sequences; renderer production code remains unchanged.
- Change only `filter.ts`, its tests, focused `render/list.test.ts` coverage, and this plan. No dependencies, unnecessary helpers, comments, README edits, staging, commits, pushes, or unrelated edits.

## Execution

1. Inspect matching, scoring, reducer integration, and grapheme-based highlight consumption.
2. Add red false-pair, whole-character ranking, UTF-16 offset, and actual-renderer regressions, with existing-behavior controls.
3. Iterate code points while retaining UTF-16 spans for match output and early scoring.
4. Run focused and full-package tests plus scoped lint/types; record evidence.

## QA And Evidence

- The parent captured and inspected `screenshots/ux-explorer-unicode-filter-before.png` using the actual reducer and renderer, showing the incorrect 2/2 count. The font lacks some emoji glyphs, so assertions prove character identity while the screenshot proves filtering/layout behavior.
- Parent owns after-QA, screenshots, review, and publication.
- Tests use in-memory rows and screen buffers with existing fixtures; no filesystem fixtures, subprocesses, network, or LLM calls.
- Preserve unrelated manifests/security-plan/assets and disjoint Runtime cancellation and traces CLI work.
- Red before production edits: focused matcher/renderer tests reported 8 failures and 34 passing controls. Failures reproduced same-field and cross-field surrogate-fragment matches in both case modes, per-surrogate scoring, lone-surrogate matching inside valid emoji, and the incorrect rendered row set.
- The matcher now uses built-in code-point arrays for comparisons and adjacency while accumulating UTF-16 offsets for returned spans and early-match scoring. Existing score constants, tie-breaking, preparation, and public interfaces remain unchanged; no helper or renderer production changes were added.
- Focused green: `node_modules/.bin/vitest run packages/toolcraft-design/src/explorer/filter.test.ts packages/toolcraft-design/src/explorer/render/list.test.ts --reporter=dot` passes all 42 tests (24 ms test execution).
- Actual reducer/renderer coverage verifies only the genuine emoji row survives, the loaded header reads 1/2, unrelated symbols are absent, and underline styles apply to the intended whole rendered cells. Controls verify a BMP character following an emoji and code-point subsequences inside ZWJ graphemes without changing renderer policy.
- Full-package green: `npm run test --workspace=toolcraft-design -- --reporter=dot` passes all 1,520 tests in 76 files.
- Scoped ESLint passes for `filter.ts`, `filter.test.ts`, and `render/list.test.ts`. Package TypeScript checking and direct strict ES2022/NodeNext checking of both changed test files and their imports pass. `git diff --check` passes.
- Source is stable and ready for parent after-QA/review. No screenshots were recreated, and no dependencies, comments, README changes, staging, commits, pushes, or unrelated edits were made.
- Parent after-QA passed using the actual reducer and renderer with synthetic rows: filtering for 😀 retained only row [1] with match positions [0, 1], excluded the cross-field 😁/🈀 false match, and preserved position [2] for B in 😀B.
- The parent captured and inspected `screenshots/ux-explorer-unicode-filter-after.png` against the before screenshot: the count changed from 2/2 to 1/2, the unrelated row disappeared, and layout remained intact. Missing emoji glyphs render as boxes, so assertions establish semantic identity rather than the image.
- Parent owns the commit after the runtime worker is safe for global lint. This follow-up changes only this plan.
