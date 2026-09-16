# Table usage draft

The bounded table operations inspect and edit existing table grids and create rectangular tables. Empty text is valid. CLI selectors and package `readTables`/`addTable`/`mutateTables` selectors are one-based: `cell: "1,2"` selects the first row and second column. Only the low-level `TableUpdate.cell: { row, column }` and live `Table.cell(row, column)` model use zero-based coordinates. Package operations reject `update.cell`; pass the selector as `options.cell`.

Rows and columns must be positive for creation. Data must exactly match the rectangular grid. Width and height are divided in whole EMUs, with remainder units assigned to the earliest columns and rows. On an existing table, `rows` and `columns` confirm its dimensions; changing grid cardinality requires a separate structural operation.

A cell text change targets one origin cell. Row height or column width targets that cell's row or column; without a cell it applies to the complete table. Supported direct fill, border and margin updates preserve other XML. Null margins and vertical anchor remove their direct override and restore inheritance/defaults. `fill: null` and `borderColor: null` explicitly select no fill; they do not restore inherited fill. Unedited theme colors are retained without conversion to guessed RGB values.

Inspection distinguishes physical cell XML and span metadata from logical grid positions. A covered cell remains present in the serialized physical grid. Formatting inspection does not assert rendered table-style cascade or visual fidelity.

The neutral live `Table` model exposes cell text, text frames, margins, vertical anchor, style switches and row/column sizes. Collections support zero-based numeric lookup, `get(index)`, `length` and iteration. Full model coverage remains tracked separately in the API receipt. Merge/split and structural row/column editing are explicit operations described below. Table placeholder insertion remains outside this bounded surface. See the research case/API receipts for exact coverage and outstanding obligations.

## Direct commands

```sh
pptx tables list deck.pptx --json
pptx tables get deck.pptx --slide 1 --table 1 --json
pptx tables add deck.pptx --slide 1 --rows 2 --columns 2 --left 0emu --top 0emu --width 11emu --height 7emu --data '[["North",""],["South","East"]]' --output added.pptx
pptx tables set added.pptx --slide 1 --table 1 --cell 1,2 --text "Harbor" --row-height 9emu --column-width 12emu --output edited.pptx
```

These command forms are exercised by the maintained table command tests. Mutations require `--output` or explicit `--in-place`. Use `--json` for structured results; `schema` and `capabilities` describe the exposed routes. Editing a row or column size updates the graphic frame's summed extent.

## Package SDK

The exported async entry points take explicit admitted input and context:

```ts
readTables(input: BinaryInput, options: TableSelection, context: SelectionContext)
addTable(input: BinaryInput, options: TableSelection & { readonly update: TableUpdate }, context: SelectionContext)
mutateTables(input: BinaryInput, options: TableSelection & { readonly update: TableUpdate }, context: SelectionContext)
```

`readTables` resolves to table records. Creation and mutation resolve to results containing serialized `bytes`, `affected` count and selected `records`. Context supplies bounded package/XML access; these functions perform no implicit host I/O.

```ts
const created = await addTable(bytes, {
  slide: 1,
  update: {
    rows: 1, columns: 2,
    left: { value: 0, unit: "emu" }, top: { value: 0, unit: "emu" },
    width: { value: 100, unit: "emu" }, height: { value: 50, unit: "emu" },
    data: [["Cove", ""]]
  }
}, context);
const edited = await mutateTables(created.bytes, {
  slide: 1, table: 1, cell: "1,2", update: { text: "Harbor" }
}, context);
const tables = await readTables(edited.bytes, { slide: 1, table: 1 }, context);
```

Each physical cell record includes zero-based `row`/`column`, `text`, span/continuation metadata, direct `fill` and `themeFill`, nullable direct margins and vertical anchor. `borders.left`, `.right`, `.top` and `.bottom` each contain `{ fillType, color, themeColor, width }`; missing direct values are `null`, and width is an EMU number. Border color/width updates apply to the four supported outer cell edges. This inspection exposes stored formatting rather than computing the rendered table-style cascade.

Cell and border `fillType` distinguishes absent/inherited formatting from explicit `noFill`, `solidFill` and retained other fill kinds.


## Merged cells and structural edits

```sh
pptx tables merge deck.pptx --slide 1 --table 1 --from 1,1 --to 2,2 --output merged.pptx
pptx tables rows add merged.pptx --slide 1 --table 1 --position 2 --span-policy expand --output taller.pptx
pptx tables columns remove taller.pptx --slide 1 --table 1 --position 1 --span-policy shrink --output narrower.pptx
pptx tables split narrower.pptx --slide 1 --table 1 --cell 1,1 --output split.pptx
```

`from` and `to` are ordered one-based row,column strings defining a complete rectangle. Reversed corners, partial intersections with existing merges, ragged grids and inconsistent span flags fail before publication. A rectangle may absorb complete existing merges. Paragraphs move in physical row order to the top-left cell; continuation cells become empty. Empty paragraph sequences remain meaningful, while a single empty paragraph body contributes no extra paragraph. Split requires the origin, clears span flags throughout its rectangle and keeps all text at the origin.

Rows and columns both support `add` and `remove`. An explicit `spanPolicy` is required even if no merge is intersected: addition accepts `expand` or `reject`, removal accepts `shrink` or `reject`. A one-based position inserts before that row/column; length+1 appends. A new row/column copies the following height/width, or the preceding size when appending. Geometry updates the table frame's summed extent. Removal cannot leave zero rows or columns. Shrinking away an origin transfers its paragraphs to the first surviving cell of that merge; deleting an entire span deletes its content.

Split requires the explicit `--cell` coordinate with simple slide/table selection. Cell location tokens are not exposed, and `--select` cannot be combined with `--cell`. Merge can use a table token with separate `--from`/`--to`; row/column operations do not accept a cell selector. Structural operations support the same explicit output, in-place, dry-run and structured-result controls as other mutations.

The live model exposes `cell.merge(otherCell)` and `cell.split()`. Model merge accepts opposite corners in either order, normalizing them to a rectangle. All model coordinates remain zero-based. Model merge/split keeps cell handles live. Successful row/column insertion/deletion invalidates existing cell, row, column, row-cell collection and bound text-frame handles; further access reports `invalid-selection`. Obtain new handles after those structural edits. Table row/column collections themselves remain live positional views.

The package SDK exposes the same structural domain behavior without implicit I/O:

```ts
const merged = await restructureTables(bytes, {
  slide: 1, table: 1,
  operation: {
    kind: "merge",
    from: { row: 0, column: 0 },
    to: { row: 1, column: 1 }
  }
}, context);
const expanded = await restructureTables(merged.bytes, {
  slide: 1, table: 1,
  operation: { kind: "rows-add", position: 1, spanPolicy: "expand" }
}, context);
```

`restructureTables` uses zero-based coordinates and positions inside its typed `operation`; outer selectors remain one-based. Operation kinds are `merge`, `split`, `rows-add`, `rows-remove`, `columns-add` and `columns-remove`. Split uses `operation.cell: { row, column }`. Unknown fields, accessors and mixed formatting/structural payloads reject before input acquisition. The direct command translates its one-based flags into this same typed domain operation.
