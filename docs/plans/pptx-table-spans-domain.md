# Table span domain implementation

Scope: `packages/pptx/src/table-spans.ts`, `tables-model.ts`, `tables.ts`, and original `table-spans.test.ts` acceptance cases. The table operation adapter, upstream accounting, and final commit are delegated separately.

## Behavior and ownership

- Structural operations accept stored data only. Validate enums, exact option keys, coordinates and mandatory span policies before input access.
- Ordered operation rectangles cannot partially intersect an existing merge. Model `TableCell.merge(other)` normalizes opposite corners; cells must have the same table owner.
- Physical cells remain present. Origins hold `gridSpan`/`rowSpan`; right continuations carry `hMerge` and top-row `rowSpan`; lower continuations carry `vMerge` and first-column `gridSpan`.
- Merge moves meaningful paragraphs from non-continuation cells in row-major order, retaining runs, formatting and fields. Empty cells do not introduce empty paragraphs; explicitly meaningful blank paragraphs do. Identity merges preserve bytes.
- Split requires an origin, retains its content, and clears span metadata throughout the rectangle.
- Insertion requires expand/reject, copies the following dimension or the final dimension on append, and expands only when strictly inside a span. Deletion requires shrink/reject and transfers deleted-origin content to the first surviving physical cell. Zero dimensions and coordinate overflow fail.
- Row/column structural mutations invalidate existing cell, row, column, row-cell collection and bound text-frame handles with `invalid-selection`; merge/split retain coordinate handles. Table-level row/column collections remain live.
- Bulk text writes cannot assign nonempty continuation content. Malformed or overlapping rectangles, orphan continuations and hidden continuation text are rejected before mutation.
- Existing foreign cell markup is preserved, including deeply nested content admitted by the source parser. Standalone fragment depth admits the already parsed document's node-count bound; final edits retain the original document's parser limits.

## Executed TDD and checks

Initial original test suite failed because the structural API did not exist. Added implementation and recorded 8 passing structural cases. Added failing regressions for stale handles, proxy-backed cell iteration, bulk continuation assignment and admitted deep foreign metadata; fixed each and reran.

The domain suite now contains 26 original in-memory cases, with no files or network required. Combined focused table/model and independently authored behavioral suites passed; package lint is also required before delivery. The final focused run passed 26/26 cases, including before-start/append insertion, interior/after-span deletion, removal of complete one-dimensional spans, exact frame extent totals, and physical row cardinality rejection. These additional boundary cases characterized correct existing behavior without source changes. No README, fixture downloads, host runtime or product network was introduced.

## QA procedure

1. Create a 3-by-3 original table with distinct text and row/column sizes.
2. Merge horizontal, vertical and rectangular ranges; inspect physical XML attributes and row-major iteration independently.
3. Split each span, inspect retained origin formatting, empty continuations and original sizes.
4. Insert/delete at boundaries, inside spans and at origins under both conflict policies.
5. Confirm malformed metadata, nonrectangular selections, missing policies and stale handles fail without modifying the input.
6. Run the adapter's SDK and CLI tests and disposable corpus QA before committing; do not execute the whole pipeline.
