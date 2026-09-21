# Bounded DOCX merged cells

Scope: F20 logical grid ownership, covered-coordinate selection, explicit utility
merge/split and row deletion through spans. Later tasks remain pending. This
record restores the missing destination already linked by the format spec and
public API audit; historical inventories and evidence remain unchanged.

## Current implementation and exact mappings

- `gridSpan` repeats an owning logical cell across columns. Matching `vMerge`
  continuations repeat that owner across rows, including combined spans. Reads
  resolve covered coordinates to the owner token; omitted slots stay absent.
  Nested tables retain independent owners and table positions.
- `editDocumentTables(input: Uint8Array, request: TableEditRequest, context:
  PublicationContext): Promise<TableEditData>` backs the plural `tables` commands
  and typed batch operations. CLI/utility coordinates and row indexes are
  one-based; live model indexes and sequence protocols remain zero-based.
- `tables.set` rejects a covered coordinate with `ambiguous-selection` unless
  `covered: owner` is explicit. The owning coordinate or token is unambiguous.
  `tables.split` selects the whole logical owner even through a covered slot.
- `tables.merge` requires ordered `from`/`to` corners and explicit
  `join: paragraphs|reject`. Partially intersected owners reject. Paragraphs
  joins retain rich blocks in physical reading order; reject accepts only
  structurally empty cells. Widths combine when defined.
- `tables.split` requires positive `rows`/`cols` dividing the owner's spans and
  explicit `distribute: anchor|paragraphs`. Anchor retains all admitted blocks
  in the first resulting owner. Paragraphs requires exactly one paragraph per
  resulting logical owner and rejects nonparagraph content. Other continuations
  receive structural empty paragraphs.
- `tables.rows.remove` through a vertical span requires `join: paragraphs`,
  retains owner and nonempty continuation content, and promotes the next retained
  continuation when deleting the anchor row. Range/complex-field movement rejects.
  Resulting grid dimensions and continuation markers are validated before
  capability-scoped publication; failures leave the memfs sink unchanged.
- Operations accept admitted bytes and explicit bounded I/O/limits/cancellation
  capabilities. There is no ambient filesystem, clock, networking or native
  reference execution. CLI camelCase JSON options and kebab-case direct flags
  share schemas, output flags, version-1 envelopes and exit categories.
- Utility selection failures use `SelectionError` with `missing-selection`,
  `ambiguous-selection` or `stale-selection` (exit 1); malformed grids use
  `InvalidPackageError`/`invalid-package` (exit 1); content/dimension and
  preservation policy failures use `UnsupportedEditError`/`unsupported-edit`
  (exit 1). Closed-schema/argument failures, including `InvalidValueError`, use
  `usage` (exit 2) and budget failures use
  `limit-exceeded` (exit 4). SDK errors retain typed categories without shell
  status coercion. Live numeric bounds map to explicit `BoundsError`, not
  Python indexing; same-table `_Cell.merge(other_cell: _Cell): _Cell` is
  synchronous and returns the resulting owning live cell.
- Neutral model `Table.cell`, `row_cells`, `column_cells`, `_Cell.grid_span`,
  `_Cell.merge`, `table_direction`, inherited `part`/`element` members, public
  `_Row`/`_Column`/`_Rows`/`_Columns`, enums and helpers retain their separate
  evidence-backed API obligations. No underscore-prefixed type is made private.
  This utility qualification does not promote whole-public-API coverage.
  `table_direction` remains the documented model spelling; no `direction`
  model alias is added. Split is an additive utility requirement, not a claim
  about a documented source model split method.

## Independent regression evidence

The existing implementation already expresses the span/content behavior in
`table-merge.ts`, `table-edit.ts`, logical locations and common operation schemas.
Five new regressions failed before product changes because admitted semantic
policies incorrectly threw `InvalidValueError` with code `usage`: nonempty merge
under reject, an unmatched paragraph count, indivisible split dimensions,
deletion through spans without paragraphs join, and removal of the last spanned
row. These are unsupported edits of the selected document, not malformed
operation schemas. The domain now throws the existing `UnsupportedEditError`
for these five cases. SDK and direct CLI share `unsupported-edit`/exit 1, null
failure data and zero affected objects. No schema, naming, content or authority
semantics are broadened.

Nine added original cases extend `table-merge.test.ts`:

- Deletion of each row of a three-row, two-column combined span retaining a
  nested table plus nonempty middle/last continuation paragraphs; all surviving
  covered coordinates alias the promoted owner and markers restart/continue.
- Width mismatch, absent restart and invalid marker value in combined-span
  continuations; rejected mutations publish nothing.
- Foreign blocks named `tcPr` or `p` under paragraph distribution, plus anchor
  distribution outside the editable profile; rejected mutations publish nothing.

Five further cases reduce the semantic-error finding to tiny original fixtures,
assert unchanged memfs publication sinks through SDK failures, and assert the
same stable categories/envelopes through actual CLI-engine dry runs.

These tiny authored fixtures extend the horizontal/vertical/omission and nested
structure concerns recorded in the existing merged-cell case verification and
corpus QA research. They contain no downloaded assets and need no QA acquisition.
The opaque-block probe was already rejected by the shared XML preservation guard;
it did not validate the suspected content loss. An initial nested-text expectation
used a newline between cells; the documented tab-separated table text expectation
was corrected before qualification. Neither probe is reported as a product bug.

## Verification and delivery

- Red: five semantic-policy regressions failed before source edits, receiving
  `usage` instead of `unsupported-edit`.
- Green: four focused original table suites passed, 151 cases, including live
  table/model behavior and SDK/CLI error parity.
- `npm test --workspace=docx -- --maxWorkers=2`: 245 files and 5,108 cases passed
  after the fix on September 21, 2026. The earlier pre-fix package qualification
  passed 5,103 cases before adding the five semantic-policy regressions.
- `npm run lint --workspace=docx`: ESLint and source/test typechecks passed;
  one existing type-only-variable warning in operation-types.test.ts, zero errors.
- `npm run build:workspaces -- --workspace=docx`: selected maintained five-build
  closure passed using the shared machine cache.
- Fresh built public model created original table bytes with an explicit UTC
  `Date` timestamp and byte sink. The built CLI engine rejected nonempty merge
  under `join: reject` at exit 1. Maintained `terminal-png` rendering was inspected:
  readable command/diagnostic, no content leakage, correct status. Root
  `screenshot-poe-code` does not expose virtual DOCX, so its maintained renderer
  was used directly. Host `/out` was read-only; the disposable screenshot was
  generated in workspace `out/docx-merged-cells-qa` and purged after inspection.
  No screenshot suite, saved QA script, download or native reference build.
- Delivery: one owned local Conventional Commit on main only. No push or release.
  Unrelated work and historical evidence are preserved; later tasks remain pending.
