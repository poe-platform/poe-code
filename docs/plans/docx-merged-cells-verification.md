# DOCX merged-cell verification

Task: `merged-cell-operations`, test step only. Later tasks remain pending.
Baseline: `main`, `7cc487c1a0f4f07091f2fb9246093c936c7dfb31`, empty index.
The existing pipeline status edits are preserved and excluded from owned commits.
Its initial SHA-256 is
`7d91c5677d463995f4f0adc695b8c98435bcd0964e031619141d893502a48c7a`.

Root owns Git coordination and this record. Leaf `merged_fix` owns
`packages/docx/src/table-merge.ts`, `table-merge.test.ts` and the subsequent
`table-merge-variants.test.ts`. Leaf `merged_integration` owns integration/export
review and the separate integration verification and research case records.
Leaf `merged_review` independently reviews behavior and corrections without
editing product files. No root exports, safe-bash source, historical seals,
README files or downloaded fixtures are assigned for modification.

## Contract and preparation evidence

The format contract remains `docs/specs/docx.md`; the shared CLI/SDK contracts
remain authoritative for operation options, one-based utility selectors,
zero-based future model collections, async publication and explicit capabilities.
The prior implementation reconciled covered-write and merge/split content-policy
wording. This verification introduces no competing format contract.

Read the corpus report and manifest, both upstream audits and inventories,
and the exact task case map. Current corpus acquisition contains 23 downloaded
documents plus separately recorded original examples; it is not product QA.
The original inventory contains 1,609 unit variants and 650 BDD examples.
The current API inventory has 920 records, replacing the pipeline's historical
331-candidate denominator. Historical records remain unchanged.

The task case map assigns 71 cases (48 unit and 23 BDD) to this task. Its entries
still point at planned tests and pending red/green evidence. Existing broad
merged-cell tests alone do not establish exact adaptation. The new research
supplement must distinguish observed utility behavior, documented language
mappings, and still-pending live model APIs; no source identity enters product
tests or fixtures. Whole-public-API and full OOXML conformance remain unverified.

## Validated row-deletion defect

An original three-row, two-column in-memory table contains one vertical owner
and a continuation with content in the final row. Deleting the middle row with
`join: paragraphs` previously moved final-row content into the owner. Bookmark
or complex-field boundaries in surviving owner or neighboring cells could then
enclose different surviving text. Checking only the deleted row was insufficient.

Four new regressions first demonstrated successful publication where
`unsupported-edit` was required. A fifth control confirms that deleting a
separate row retains a marked span unchanged. The correction scans the table
with charged work before moving any content through a crossing vertical span,
and rejects range/complex-field boundaries. Ordinary noncrossing row deletion
retains its existing behavior. Rejection occurs before output publication.

The independent reviewer reran separate owner-anchored and neighbor-anchored
bookmark reproductions after the correction: both rejected with
`unsupported-edit` and zero published bytes.

## Verification procedure and results

1. Inspect prior red logs, existing tests and retained terminal screenshots.
2. Run the original marker regressions before modifying the movement guard;
   inspect the failed assertions and publication behavior.
3. Apply the guard, rerun the regressions and independent reproductions, then
   run maintained docx unit/lint/build checks and focused Shell integration.
4. Reconcile all 71 assigned cases separately from live-model/API coverage.
5. Inspect owned changes and explicitly commit each verified atomic correction.
   Preserve the original index and plan edits. Do not push or release.

Initial baseline checks passed: `npm test --workspace=docx` (61 files, 1,567
tests) and `npm run lint --workspace=docx` (ESLint and source/test TypeScript).
These predate the correction and are not its final green evidence.

Retained original red logs were available, including the corrected initial
9-failure/7-pass run and the later partial-subdivision failure. Both original
merge/split terminal PNGs were visually inspected: required policy flags are
readable, success exits 0 and missing coordinates exit 1. This is a review of
retained terminal evidence, not a fresh capture or rendered document validation.

Correction checks, 2026-09-14:

- Red: `npm test --workspace=docx -- -t 'span deletion|separate row'`
  reproduced four failures; the unrelated-row control passed.
- Green: `npm test --workspace=docx` passed 61 files and 1,572 tests.
- `npm run lint --workspace=docx` passed ESLint and both TypeScript checks.
- `npm run build:workspaces -- --workspace=docx` passed all five builds in
  the declared dependency closure and native postbuild checks, uncached.
- Independent owner/neighbor reproductions rejected with zero published bytes.
- `git diff --check` passed.

Raw correction evidence remains separate in
`/tmp/docx-merged-range-red-20260914.log`,
`/tmp/docx-merged-range-green-20260914.log`,
`/tmp/docx-merged-range-lint-20260914.log`, and
`/tmp/docx-merge-verification-build.log`.
The source correction, five regression cases and this record form an atomic
local fix. The subsequent exact case adaptation is a separate improvement;
the pipeline test status remains open until its requirements are reconciled.

A fresh ad hoc CLI capture after `8943f8923` was generated through
`npm run screenshot` and visually inspected at
`/tmp/docx-merge-range-rejection-verification.png`. An original in-memory marked
table passed to `tables rows remove --table 1 --index 2 --join paragraphs
--dry-run` reports `unsupported-edit` with exit 1 and no document text in the
diagnostic. This verifies terminal output only, not rendered Word pages.

No downloaded documents were opened, changed or removed. No corpus, rendering,
full safe-bash unit gate, remote-main delivery or release result is claimed.

## Original variant qualification

The separate `table-merge-variants.test.ts` adds 63 original memfs cases.
They cover empty/reject merges, omitted-property defaults and exact counts,
pre-mutation spans 1/2/4, off-origin and previously merged rectangles, all logical
aliases, rejected partial intersections, rich-block transfer and resulting
physical gridSpan/vMerge markers. Width checks bind the selected owner rather
than matching unrelated width attributes elsewhere in the output.

These are verification additions to existing behavior. Initial runs passed
except one test-authoring correction: reversed utility corners return the
existing `usage` error. That correction is not a product defect or historical
red evidence. The five range-regression cases above remain separate.

- `npm test --workspace=docx` passed 62 files and 1,635 tests in
  `/tmp/docx-merged-variants-final-20260914.log`.
- Subsequent assertion-only refinements passed the 24 affected cases in
  `/tmp/docx-merged-variants-targeted-final-20260914.log`, and the three
  pre-mutation span cases in `/tmp/docx-merged-span-read-final-20260914.log`.
  The full-suite run predates those refinements; unchanged cases were not rerun.
- The final variant file SHA-256 is
  `26533d57a19e6c3f85410f9ba866388fc3c6531d077cfa67513c47392f0b0ea2`.
- `npm run lint --workspace=docx` passed on that final file, including ESLint
  and both source/test TypeScript checks. Log:
  `/tmp/docx-merged-variants-lint-final-20260914.log`.
- The reference-identity scan of docx source/tests and explicit safe-bash docx
  source/tests returned no matches; standalone legal notices were preserved.

The [research supplement](../docx/merged-cell-case-verification.json) retains
all 71 assigned source identities and exact bound parameters. Independent review
checked source topology and expected geometry, donor/destination ordering,
target titles and explicit many-to-one mappings. Its result is 71 verified
utility-mapped behavioral dispositions, not unchanged source parity or complete
live-model implementation. Ordered utility corners and conservative rich-content
retention remain explicit differences. The public `_Cell.merge`, span/omission
getters and full live table owners retain their later API obligations.

The [integration record](docx-merged-cells-integration-verification.md) separates
baseline checks, the corrected 47-test Shell run, 515 runner checks, export
checks and maintained source/test/consumer typechecking. It retains the initial
overlapping typecheck failure beside the stable sequential pass.

Only F20's bounded utility behavior is qualified here. Broader F01–F50, full
public API, corpus, independent rendered-document QA and later pipeline tasks
are not completed by these tests. Required README delivery remains pending
permission. The disposable corpus is retained for later campaigns; cleanup count
is zero. The preexisting pipeline status edits remain outside owned staging.
