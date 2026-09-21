# Bounded DOCX table editing

Scope: logical table inspection and selected cell/row/column utility edits only.
Construction, merged-cell extensions and later tasks retain their separate scope.
Existing original names, tests and unrelated work are preserved.

## Behavior and exact mappings

- `inspectDocumentTable` and `inspectDocumentTables` asynchronously accept admitted
  `Uint8Array` input and explicit `ArchiveContext`; CLI routes are `tables get`
  and `tables list`. Logical cells report 1-based row/column positions, spans,
  omitted slots, exact stored text and revision-bound locations. Nested tables
  and explicitly selected header scopes retain their owning part/story.
- `editDocumentTables(input, request: TableEditRequest, context:
  PublicationContext): Promise<TableEditData>` serves direct CLI and typed batch
  operations with the same closed camelCase option schemas. Table ordinals and
  structural indexes are 1-based; `A1` means first column, first row. Locations
  are source-bound anchors; missing, stale and ambiguous selections fail.
- `tables.set --table 1 --cell B2 --text VALUE` explicitly replaces the cell
  value/runs and collapses simple multi-paragraph content. It preserves cell
  properties and admitted first-paragraph markers. Formatting-only `tables.set`
  preserves values, fields, bookmarks and nested tables. Whole-value assignment
  differs from the format-preserving `text replace` operation.
- `tables rows add` and `tables columns add` explicitly grow a rectangular
  unmerged grid, inserting empty cells before `--index N`; count+1 appends and
  an omitted insertion index appends. Setting a value never grows the table.
  `tables rows remove` and `tables columns remove` delete the explicit index and
  retain at least one row and column. Untouched rows/cells/properties retain
  lexical XML. Repeated headers must remain consecutive leading rows.
- Value replacement rejects nested tables, fields and opaque content rather than
  discarding them. Structural deletion rejects affected range markers/complex
  fields. Replacement also rejects removing annotated later paragraphs,
  including note/comment reference markers. Out-of-bounds edits fail before
  publication. All mutations use supplied capabilities, shared budgets and final
  candidate validation; no host I/O, networking or native reference execution.
- Common output/inPlace/force/dryRun semantics and version-1 JSON remain shared.
  Unsupported edits use `unsupported-edit`/exit 1; missing/ambiguous/stale anchors
  use selection codes/exit 1; schema errors use `usage`/exit 2; limits use
  `limit-exceeded`/exit 4. SDK callers receive typed errors, not shell statuses.
- Neutral live model spellings (`Table.cell`, `add_row`, `add_column`, `_Cell.text`,
  `table_direction`) retain their documented mappings. Live collections use
  zero-based lookup, iteration and explicit at/slice protocols; CLI positions
  remain 1-based. Public `_Cell`, `_Row`, `_Column`, `_Rows`, `_Columns`, inherited
  part/table/element members, enums, aliases and helpers remain public obligations.
  This utility fix neither hides nor promotes their separate API-map rows.

The pinned `docs/docx/upstream-api-inventory.json` remains historical research.
The current audit and live-model evidence keep their separate dispositions.
Documentation drift is resolved by restoring this missing spec-linked record;
the documented direction spelling remains `table_direction`, without introducing
the erroneous `direction` model alias. Whole-public-API coverage is not claimed.

## Failing tests before code

Two original valid package fixtures contain two references to the same footnote
or endnote in successive paragraphs of one cell. Before the fix, replacement
published successfully while deleting the second reference: the surviving first
reference prevented orphan detection from catching that loss. Tests now require
`unsupported-edit` and an unchanged memfs output sink. The editor reuses the
existing paragraph annotation/reference classifications when checking paragraphs
that would be removed. Initial incomplete fixtures failed package validation;
they were corrected before implementation and are not counted as bug evidence.

Existing original suites cover exact Unicode/space/tab/newline values, bookmarks,
cached and spanning fields, nested tables, body/header isolation, inserted rows
and columns, headers, formatting, deletion and rejected bounds/anchors. No
downloaded fixture or historical evidence is changed.

## Verification

- Focused table suites: 4 files, 44 cases passed after the fix.
- `npm run build:workspaces -- --workspace=docx`: passed selected dependency
  closure and package build.
- `npm run lint --workspace=docx`: passed ESLint and source/test typechecks;
  one unused-variable warning in operation-types.test.ts, zero errors.
- `npm test --workspace=docx -- --maxWorkers=1`: 245 files and 5,094 cases passed
  on September 21, 2026. The initial default-worker run overlapped build/lint
  and had one 5-second dialect timeout; that case passed separately and in this
  complete rerun (445 ms). No timeout or product semantics were relaxed.
- No CLI rendering change or new screenshot tests.
- Delivery: owned local Conventional Commit on main only; no push or release.

Later tasks remain pending.
