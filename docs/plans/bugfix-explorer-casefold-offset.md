# Explorer case-fold offset bugfix

## Scope

- Keep whole-string `toLocaleLowerCase()` matching, code-point subsequences, scores, and row ordering unchanged.
- Project only winning match positions onto the original ANSI-stripped title/subtitle UTF-16 offsets. Match positions must not point at later characters after lowercase expansion or contraction.
- Reuse the existing pure grapheme helper for a single forward projection pass. Preserve exact offsets within unchanged-length clusters; map matches inside a length-changing cluster to its whole original span, once. This is bounded highlight provenance, not normalization or a new grapheme-atomic matching policy.
- No generic diff, casing tables, production locale overrides, growing-prefix comparisons, dependencies, renderer production changes, README edits, inline comments, staging, commits, or pushes.
- Owned paths: `filter.ts`, `filter.test.ts`, `render/list.test.ts`, the narrow pure-helper allowance in `imports.test.ts`, and this plan.

## Execution

1. Add failing offset and rendered-highlight tests before production edits.
2. Cover repeated expansion, unchanged combining/ZWJ spans, supplementary characters, ANSI stripping, subtitle offsets, case sensitivity, Greek contextual casing, Turkish contraction, and Lithuanian expansion.
3. Compare matching scores/order with whole-string folded controls and bound the total text lowercased during projection rather than using timing assertions.
4. Run focused tests, package tests, scoped lint, and type checks.
5. Record results and hand off after-QA to the parent.

## QA

- Parent captured `screenshots/ux-explorer-casefold-offset-before.png`: querying `a` in `İab` highlights `b` because folded position 2 was used as an original offset.
- Parent owns after-QA, screenshots, review, and publication, including real-locale process controls.
- Unit fixtures remain in memory; locale controls delegate to the real builtin with an explicit test-only locale. No subprocesses, files, network, or LLM fixtures.
- Preserve unrelated manifests, security plan, terminal assets, and disjoint runtime work.

## Results

- Red before production edits: the focused matcher, renderer, and import-boundary suite reported 34 failures and 58 passing controls. Failures demonstrated shifted offsets, missing original cluster spans, incorrect highlights, and the missing narrow helper allowance.
- Added 47 tests: 36 matcher/projection controls, 10 actual renderer/reducer highlight controls, and one import-boundary control. Existing tests and snapshots remain unchanged.
- The production change adds one private projection function and calls it only after the existing matcher chooses a winning match. Its forward walk processes disjoint graphemes and sorted match positions, expanding each changed cluster at most once. No matching, scoring, tie-breaking, renderer, or public API logic changes.
- Whole-string matching still determines Greek final sigma. Test-only Turkish and Lithuanian locale controls retain the real builtin casing implementation. They verify contraction/expansion offsets and compare scores against whole-string folded, case-sensitive controls.
- Focused green: `node_modules/.bin/vitest run packages/toolcraft-design/src/explorer/filter.test.ts packages/toolcraft-design/src/explorer/render/list.test.ts packages/toolcraft-design/src/explorer/imports.test.ts --reporter=dot` passes all 92 tests; final test execution took 41 ms.
- Full-package green: `npm run test --workspace=toolcraft-design -- --reporter=dot` passes 1,623 tests across 77 files, up from 1,576 tests. Test execution took 2.59 seconds; total command duration was 6.14 seconds.
- `npm run lint --workspace=toolcraft-design` passes package ESLint and TypeScript checking. Direct strict ES2022/NodeNext checking of the three changed test files and their imports also passes. The direct test check initially caught a numeric reduce accumulator inferred as unknown; adding its numeric type parameter fixed it without changing behavior.
- `git diff --check` passes. Source is stable and green for parent review and after-QA; global hooks remain parent-coordinated with the disjoint runtime worker.
- Parent after screenshots and real-locale process QA are pending at handoff. No baseline was recreated, and no unrelated changes were modified or reverted.

## Parent verification

- Drove the actual reducer with filter input `a`, rendered both rows, and checked
  the screen cells: `Cab` and `İab` now both underline `a`. Row order stays
  unchanged. Captured and inspected
  `screenshots/ux-explorer-casefold-offset-after.png` against the before image.
- Passed 26 ad hoc process controls across real default locales `en-US`, `tr-TR`,
  and `lt-LT`. They cover expansion/contraction, whole-cluster projection,
  subtitle offsets, supplementary characters, combining marks, contextual Greek
  sigma, case-sensitive offsets, and scores against whole-string folded controls.
- Initial QA assumed dotless-i matching for ASCII `Iab` under the Turkish process
  locale, but this process's unchanged no-argument builtin returned `iab`.
  Removed that unsupported policy expectation; no casing policy was changed.
  The final checks exercise the actual builtin behavior and original offsets.
- These are memory-only ad hoc probes, not subprocess unit tests or persisted QA
  scripts. Production review confirms a single forward projection pass and no
  new dependency, public option, or renderer behavior beyond corrected positions.
