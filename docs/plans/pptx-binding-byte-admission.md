# PPTX binding byte admission

## Scope and ownership

Root owns `packages/pptx/src/template-bindings.ts`, its existing test file,
this plan and the draft binding usage guide. A delegated leaf owns the existing
safe-bash binding acceptance test and its separate CLI receipt. No adapter or
root API changes are needed. Preserve all unrelated work; commit locally on main
without pushing, releasing, editing README files or running the whole pipeline.

## Validated defect and implementation

Binding admission and repeated replacement budgets counted UTF-16 code units
against byte limits. Three original failing cases supplied CJK text, supplementary
Unicode text and structured table cells. With a nine-byte budget they incorrectly
read the document and reported invalid-archive instead of rejecting the payload.
The CLI independently reproduced a parse-phase resource error rather than an
admission-phase error with 3,000 CJK characters and an 8,192-byte XML ceiling.

Count UTF-8 bytes without allocating an encoded payload for admission. Apply the
same accounting to cumulative payloads, per-binding XML content and projected
repeated text. Marker positions remain UTF-16 offsets for exact string slicing;
this changes no Unicode normalization or literal marker semantics. Image bytes
retain their existing accounting. XML escaping and package serialization remain
subject to their existing final limits.

Original tests additionally cover the exact ten-byte boundary, independent XML
ceiling, and multiplied ASCII/CJK/supplementary replacements. Existing formatting,
literal braces, structured table/image, repeated-name and no-evaluation tests
remain. CLI validation tests assert unchanged files and zero publication calls.

## Research accounting

Consulted the pinned test/API audits and inventories, the shared office SDK/CLI
contracts, the format's bounded binding section and corpus manifest. The existing
[binding research receipt](../pptx/template-bindings-evidence.md) accounts for
both template-named unit candidates and the default-template BDD scenario; none
is a data-binding API. All 2,700 unit variants, 973 expanded BDD cases and 2,407
public API records retain their existing component-ledger dispositions. This
security regression adds no upstream parity claims and does not complete F57
repeated slides or the live public model. Required standalone legal notices are
unchanged. No derived implementation, fixture or test wording is introduced.

## Verification and disposable QA procedure

1. Run original focused domain/command tests, selected workspace build closure,
   maintained package lint/typechecks and delegated Shell acceptance tests.
2. Run the maintained full pptx package test route. If unrelated working changes
   interfere, use a temporary HEAD package copy with only the owned source/test
   changes, unchanged Vitest configuration and existing explicit test helpers.
   Record both outcomes; do not exclude tests from that committed package.
3. Verify the SHA-256 of the first already cached corpus-manifest entry. Admit
   its bytes with explicit bounded context and confirm empty bindings preserve
   every byte. Present oversized Unicode bindings through a counted input source
   and require rejection before reading it. Never download or write corpus data.
4. Inspect a screenshot of actual command error output. Review owned diffs,
   stage only explicit files, and commit after relevant checks pass.

Corpus QA passed on the 1,202,514-byte cached deck with SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
Empty bindings retained identical bytes; oversized CJK content was rejected in
admission with zero reads. No downloaded material, output package or QA script
was added. This is structural evidence, not rendered-fidelity evidence.

Selected build closure passed all three declared dependency builds. Maintained
`npm run lint --workspace=pptx` passed, including source and test typechecks.
Delegated CLI verification passed five tests and focused strict TypeScript;
the actual resource-limit screenshot was inspected as recorded in
[the CLI receipt](pptx-binding-validation-cli.md).

The whole working-package run encountered three failures in the untouched,
uncommitted sanitization tests: a ZIP-version fixture expectation and two
canonical-part/report expectations. Those files are outside this assignment.
The intended-commit package check and final focused results are recorded below.

Final intended-commit verification: `npm run test --workspace=pptx` passed all
4,316 tests in 173 files (183.52 seconds) in the temporary HEAD package copy with
the final owned changes. Shared package sources, root configuration/setup,
the reporter and the explicit safe-fs XML helper retained their maintained
implementations. No tests from that package were excluded. The working-package
run separately finished with 4,367 passes and the three recorded failures.
Final focused verification passed all 38 tests in the three binding/domain
command files; a final strict test typecheck passed after the added boundary and
repeated-Unicode assertions. Owned diffs passed whitespace checks.
