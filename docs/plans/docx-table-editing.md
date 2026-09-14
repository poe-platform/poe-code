# Bounded DOCX table editing

Status: implemented and verified locally; no push or release.

Scope: logical table inspection and selected cell/row/column edits only. Work on
main, test before implementation, explicit owned staging and local Conventional
Commit. No push or release. The preexisting edits in
`docs/plans/docx-typescript-safe-bash.md` remain untouched and excluded. Later
merge/split, full live-model and subsequent pipeline tasks remain pending.

## Contract and exact language/security mappings

`inspectDocumentTable(bytes, options, context)` implements `tables.get` and returns
the shared resource envelope `{item}`. Its table `details` contain one physical
anchor per logical merged region, row/column spans, exact logical text and explicit
leading/trailing omissions. Coordinates and command positions are 1-based;
uppercase A1 notation and revision-bound location tokens identify targets. Nested
table ordinals follow existing story traversal; a cell token inspects its nearest
owning table. This bounded inventory exposes structural details; the complete
model-property/reference inventory remains pending.

`editDocumentTables` retains `tables.add` and adds `tables.set`,
`tables.rows.add/remove` and `tables.columns.add/remove`. Set never grows a grid.
Add inserts before an explicit 1-based index and defaults to count+1; remove
requires an existing index. Structural edits require an unmerged rectangular
grid. Formatting preserves values and unrelated XML. Whole cell replacement is
distinct from formatting-preserving `text.replace`; unsupported destructive
replacement rejects before publication. No implicit trimming, number coercion,
formula interpretation, field evaluation or networking is permitted.

| Public obligation | Exact mapping and bounded disposition |
| --- | --- |
| Table.cell, row_cells, column_cells | Future model positions remain zero-based; current utility locations/coordinates are 1-based. Merged aliases resolve to one physical owner. Full live model lookup and repeated collection identity remain pending. |
| Table.add_row/add_column, rows/columns | Utility insertion/deletion has explicit bounds and preserves existing cells. Model add_column retains positional width; add_row has no arguments. Live returned _Row/_Column and collection APIs remain pending. |
| Table.autofit/alignment/style/table_direction | Utility camelCase option spellings remain separate from neutral model spellings. D03's documented direction typo does not introduce a model alias. Null resets apply only to declared nullable fields. Full live property owners remain pending. |
| _Cell.text/width/grid_span/vertical_alignment | Utility replacement is restricted to safely replaceable cell content; destructive model text setter semantics remain pending. Grid spans are inspection data. _Cell stays public despite its underscore. |
| _Cell.add_paragraph/add_table/paragraphs/tables/iter_inner_content | Existing typed construction retains nested order and terminal paragraphs. General live getters, methods, iteration and returned owners remain pending. |
| _Row.cells/table/height/height_rule/grid_cols_before/grid_cols_after | Row flags operate through selected cell or all table rows; omitted slots are reported, never fabricated. Other live properties remain pending. |
| _Column.cells/table/width | Explicit grid insertion preserves surviving cell widths and content; full live column setter/collection semantics remain pending. |
| _Rows/_Columns | JS at(index), length and Symbol.iterator remain planned; _Rows slice(start,end) preserves slicing semantics. No public underscore interface or inherited member is hidden. |
| Inherited part/table and XML/package views | Owner-bound capabilities only. No ambient host I/O, dependency XML runtime exposure or implicit resource activation. Pending live members retain their inventory status. |
| Enums/helpers | Utility tagged enum values and typed Length retain the existing finite safe-number and rounding contracts. Full enum aliases/protocols and synchronous live helpers are not promoted by utility tests. |
| Async and publication | Both utility entry points always return Promise. Owned Uint8Array, explicit context/limits/cancellation and capability-scoped output use the existing validated publication engine. Ordinary exit statuses and version-1 envelopes remain shared with CLI. |

Read the pinned audit and 920-record API inventory, including inherited table
members, collections and D03. The historical inventory remains unchanged; this
bounded task does not assert complete public-model coverage. Independent original
cases cover meaningful behavior without native builds, downloaded assets or
source-derived wording; no new derived-material notice is needed.

## Test-first evidence

- Four new inspection/discovery/selection tests failed before implementation:
  missing inspection entry point, rejected discovery support, and table-token
  row insertion incorrectly requiring a story anchor.
- Three new Shell/memfs cases failed with unsupported-profile while all six
  original table construction integration tests passed. Cases assert exact
  Unicode, leading/trailing spaces, zero-padded and formula-looking literals,
  dry-run immutability, inserted coordinates and preserved forced destinations.
- Engine regressions and final maintained checks are recorded below.

The 28 original editor regressions include inserted/deleted rows and columns,
leading repeated headers, exact lexical retention of surviving cells/properties,
bookmarks, fields, nested-table ordinals, header scope, null/false/zero formatting,
plain multi-paragraph replacement and omitted column width from stored container
geometry. Explicit column growth preserves existing column widths; the new width
defaults to floor(container width / resulting column count), in twips. A supplied
row width must equal the stored grid sum. At least one row and column must remain.

Review added failing regressions for an extension prefix colliding with an editor
prefix, returned cell paths shifting when row properties are inserted, unsupported
wrapped cells, positive absent row/column indexes and field results spanning cells
or enclosing tables. Each was reproduced before fixing. Out-of-bounds positive
indexes return missing-selection (exit 1); invalid numeric syntax remains usage
(exit 2). Whole-cell text rejects enclosing field ranges; formatting preserves
their cached results. Explicit row/column deletion may remove selected cached
result content but rejects deletion of range or complex-field boundary markers.

Six original read/discovery cases cover logical merged spans/omissions, exact
nested text, stale/missing locations, header fields, token insertion admission and
applicable help/capability declarations. The existing exact discovery inventories
were extended with literal new paths while preserving all original paths/tests.
The initial full package run retained four failures (two outstanding editor
regressions and two discovery inventory expectations); these were resolved before
the final run. The first lint run caught a missing explicit encoding in a new
test context, corrected before the maintained successful rerun.

## Verification

Verified on 2026-09-14 against the owned working tree:

- `npm test --workspace=docx`: 60 files and 1,542 tests passed, including all
  original tests, 28 new editor cases and six inspection/discovery cases.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript passed.
- `npm run build:workspaces -- --workspace=docx`: maintained five-workspace
  dependency closure and native postbuild export checks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts
  packages/safe-bash/tests/commands/docx-registration.test.ts`: 46 passed.
- Scoped adapter/test ESLint passed. `npm run test:runner
  --workspace=virtual-bash`: 515 maintained runner checks passed. The edited
  existing integration file was already registered; no inventory exclusion.
- `npx vitest run scripts/docx-exports.test.ts`: both portable/browser export
  checks passed. Root runtime wiring and dependencies are unchanged.
- Ad hoc actual Shell help/read/dry-run/error output was captured using
  `npm run screenshot` and visually inspected at
  `/tmp/docx-table-edit-cli-final-20260914.png`. Read and dry-run exit 0;
  missing-index rejection exits 1. The earlier screenshot is retained separately
  at `/tmp/docx-table-edit-cli-20260914.png`; it exposed the corrected exit-2
  classification. Neither screenshot nor disposable logs are committed.
- `git diff --check` passed.

This is terminal and structural QA, not rendered document glyph/page validation.
No downloaded fixtures, native reference builds, product networking, complete live
model, merge/split editing, remote-main delivery or release is claimed. Later
tasks remain pending. Only the explicitly owned implementation/tests and this
plan/spec/audit reconciliation are included in the local feature commit.

## Verification-only review, 2026-09-14

Reviewed the existing implementation at `086456dc1` against the bounded task,
root/scoped instructions, DOCX specification, shared CLI/SDK contracts, API audit
and table inventory (including inherited and public underscore-prefixed members).
No new product defect was reproduced and no implementation or original test was
changed. The detailed specification still classified cell and row/column editing
as later work, contradicting its introduction and the implemented operations.
Corrected that status sentence without promoting merge/split or live model APIs.

Fresh checks:

- `npm test --workspace=docx`: 60 files, 1,542 tests passed.
- `npm run lint --workspace=docx`: ESLint and both TypeScript checks passed.
- `npm run build:workspaces -- --workspace=docx`: declared five-workspace build
  closure and native postbuild checks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts
  packages/safe-bash/tests/commands/docx-registration.test.ts`: 46 passed, no skips.
- `npm run test:runner --workspace=virtual-bash`: 515 passed, no skips; the
  original table integration file remains explicitly registered.
- `npx vitest run scripts/docx-exports.test.ts`: both export checks passed.
- `git diff --check`: passed.

Inspected the original preservation/assertion cases and retained green logs,
including the final 1,542-test package and 46-test Shell results. Visually
inspected `/tmp/docx-table-edit-cli-final-20260914.png`: readable one-based help,
exact numeric-looking cell text, dry-run exit 0 and missing-index exit 1. This
was retained terminal evidence, not a fresh screenshot or document render.

The test-first section above records the original red phase, but editing-specific
raw red logs were not located during this review. Available table red logs cover
earlier construction corrections; they do not independently prove editing's red
phase. Historical evidence is preserved, not reconstructed or relabeled.
Full live table API/property/reference coverage, merge/split editing, document
rendering and broader corpus QA remain unverified by this bounded review. No
full repository or full safe-bash suite was run. No new code required a regression.
Only this plan update and the specification status correction belong to the
review commit; the preexisting pipeline-plan change and index remain preserved.
No README edits, downloaded fixtures, native reference build, push or release.
