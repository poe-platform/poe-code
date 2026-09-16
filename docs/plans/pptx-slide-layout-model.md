# Live PPTX layouts and synchronous slide creation

## Ownership

Own new `slide-layout-model.ts`, its original test file and
`indexed-collection.ts`; own the admitted-state extractions in `slides.ts` and
`selectors.ts`. Coordinate exact `slide-model.ts` and `presentation-model.ts`
hunks with chart/owner and hyperlink workers. The integration owner owns the
isolated root public export hunk and commits. Evidence belongs in
`docs/pptx/slide-layout-model-evidence.md`; no README edits or external fixtures.

## Implemented sequence

1. Reproduce absent `slide_layouts`/`add_slide` with three original failing tests.
2. Extract existing synchronous slide preparation and selection indexing from
   their async admission/publication boundaries. Retain one domain editor.
3. Reuse the numeric collection proxy through one internal shared helper.
4. Add first-master ordered layout views and a same-package insertion capability.
   Keep existing slide handles and append to the existing collection. Refresh
   internal inventory atomically so new-slide chart/image methods work.
5. Extend tests for original sparse layout prompts/keys, typed lookup/defaults,
   missing master errors, pending workbooks, old handles and new-slide image I/O.
6. Validate focused tests, test types and scoped lint; hand off maintained package
   test/lint/build and adapter integration to the coordinating owner.

## Agent QA

Run the original layout model tests and existing slide insertion, selection,
presentation, numeric collection, and direct slide command suites. Exercise the
public root export and compare original model and CLI output part payloads.
Confirm first-master registration order, zero-based model versus one-based CLI
positions, sparse placeholder keys, unchanged old owners, unchanged state on
foreign/null/invalid inputs, pending workbook continuity, and always-async image
admission. Check missing-master and missing-name/fallback errors separately.
Run maintained checks before the local atomic commit, staging only owned files
and exact owned shared hunks. No push or release is authorized.

Record unsupported returned graph members in the API register; passing these
original cases does not establish full layout, guide, source-test or public API
coverage. Preserve the full denominator and unrelated work.
