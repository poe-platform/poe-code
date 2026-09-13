# Table span accounting and validation

This bounded change implements the F29 table structural operations. Ownership is limited to the table case/API receipts, direct-command receipt reconciliation, draft table usage and the independent `packages/pptx/src/table-span-behavior-cases.test.ts` suite. Domain and adapter work are delegated separately; no whole pipeline, downloads, README changes, push or release belong to this task.

The pinned research inventories and behavioral evidence remain immutable. The table case receipt already retains every direct `tests/test_table.py` and `tests/oxml/test_table.py` parameter and every selected table/cell/column BDD example. Inspection found 45 previously deferred structural rows: 42 merge/range/split obligations and three placeholder insertion obligations. Placeholder insertion is a separate wider shape-model operation and remains visible as deferred. Existing table cell identity/equality, inherited `part`, fill graphs and other wider APIs are not silently counted as implemented.

Original independent markup supplies dimensions, paragraphs and expected physical cell state. It does not reuse the product table generator as the expected result. The initial focused run failed all 16 initial cases because model merge/split did not exist. Later additions cover partial horizontal/vertical intersections and the 3x3 BDD paragraph-owner rectangle. No fixture files, native runtime, ambient I/O or downloads are involved.

Range-helper cases map to observable complete physical span matrices. Horizontal, vertical, reversed 2x2 corners, full 3x3 and offset 2x2 rectangles assert which cells receive horizontal/vertical continuation roles and widths/heights; this replaces internal helper iterator/mock identities without discarding their parameter geometry. Six migration cases preserve meaningful empty-paragraph pairs, skip single empty bodies, move paragraph owners in physical row order and keep released cells empty after split.

Model `cell.merge(other_cell)` normalizes opposite corners. Direct `tables merge --from ... --to ...` requires an ordered rectangle. This preserves the neutral model contract and the shared command contract as distinct interfaces. Indices are zero-based safe nonnegative integers in the model and one-based strings/positions in operations; negative indices, fractional indices and implicit expression evaluation are never added.

## Verification procedure

1. Run the independent original case suite and domain structural tests after the red baseline.
2. Run maintained `npm run lint --workspace=pptx` and `npm run test:unit --workspace=pptx`, plus the adapter owner's focused maintained checks.
3. Check every changed case row references an existing exact original test title and selected parameter identity, keeping differences explicitly mapped rather than declaring parity.
4. Check merge/split API signatures, errors, structural invalidation, one-based operation coordinates, conflict-policy enums and schema/capabilities against executable code.
5. Inspect the CLI help/schema screenshots through the root agent's ad hoc QA. Any disposable corpus campaign must use `docs/pptx/corpus-manifest.json`, operate on disposable copies and reduce findings to original regressions. No corpus campaign was executed for this receipt.
6. Commit only the explicitly owned files and relevant plan after required maintained checks. Parent owns commits. No push or release.

Validation results are appended after execution; planned checks are not passes.

## Executed receipt

- Independent original span suite: 21/21 passed; one run completed in 233 ms. It includes Saxes assertions of exact serialized `gridSpan`, `rowSpan`, `hMerge` and `vMerge` for an offset rectangle, without using the product reader to determine expected XML attributes.
- Owned test ESLint and `tsc -p packages/pptx/tsconfig.test.json --noEmit` passed.
- Receipt audit: all 42 changed merge/range/split rows resolve to exact historical inventory identities and existing original test titles. No direct table-unit inventory rows are missing. The table receipt still has 212 records: 166 original-behavior-covered, 14 partial, 20 wider-model deferred, three placeholder structural deferred and nine language/security mapped. One of the nine is the explicit complete-contained-span policy difference, not source parity.
- Parent reported the maintained package test route passed 103 files / 2,945 tests in 32.64 seconds, package lint passed, the selected workspace build passed, and five registered shell table tests passed. Further domain boundary regressions and final build checks remain recorded in the parent's main QA receipt.
- Parent reported CLI screenshot inspection and disposable corpus SDK/shell merge, expanded column insertion, origin column deletion/shrink and split equivalence, including 128 of 129 members byte-identical and independently checked text and sizes. Corpus QA execution/evidence belongs to the parent's QA receipt, not this accounting agent's local checks.

This receipt does not claim whole public API completion, rendered table fidelity, publication, push or release. The original inventories and standalone legal notices remain retained unchanged.

Final parent follow-up reported 26 domain structural cases and 58 focused cases passed, including the added structural boundary regressions.
