# Table domain implementation receipt

## Owned scope

The domain worker owns packages/pptx/src/tables.ts, tables.test.ts,
tables-model.ts and tables-model.test.ts. Root owns SDK/command integration,
schemas, exports and commits. Independent accounting owns the parameter cases
and research receipts. No README changes, host filesystem access, native runtime,
network access or fixture downloads belong in the domain.

## Design

Rows and columns define the logical rectangular grid. Each physical `tc` is
retained, including spanned positions with independent hidden text. Read results
report physical zero-based row/column positions, span dimensions and merge roles;
text assignment to one cell requires a non-spanned origin. Full `data` is a dense
rectangular string array with exact cardinality. Structural merge/split and
row/column insertion/deletion remain explicit unsupported work.

Creation divides integer EMUs with remainder units assigned to earliest grid
positions. Row/column sizing changes update summed frame extents, with explicit
bounds on each length and its total. Stored universal measurements are parsed
without regexes; tests cover the concrete `10pt`/`12pt` findings from the inventory.
No geometry, text or color normalization runs for an unchanged table operation.

Cell edits retain text-body configuration, unknown extensions, style references
and theme-linked fills/borders outside the requested property. Direct RGB fills
and four borders use the shared Color contract. Reads distinguish direct RGB
and theme colors and absent margins. Cell and border fillType retains explicit
noFill versus absent inheritance, with opaque fill kinds identified without flattening. Boolean style options map to DrawingML
firstRow/lastRow/firstCol/lastCol/bandRow/bandCol. Origin cell text preserves
paragraph and soft-break distinctions and supports empty strings.

The live model exposes Table, TableCell, TableRow, TableColumn and corresponding
collections, direct neutral property names and typed Lengths. Numeric collection
lookup, `.get(index)`, iteration and length are available; negatives, fractions
and missing positions reject. Cell defaults are 91440 horizontal and 45720
vertical EMUs while direct records retain null inheritance. Cached standalone
text frames write back into their live physical cell, subject to the same
selection locks and span-origin checks. Source-only structural APIs, complete
fill object model and table-part inheritance remain visible coverage gaps in
research; these classes do not imply whole-public-API completion.

## TDD and validation

- Initial original grid tests failed because tables.ts did not exist.
- Initial model tests failed because tables-model.ts did not exist.
- Independent assertions exposed and corrected bandRow/bandCol mapping and
  universal-measure parsing; the latter previously produced NaN summed extents.
- Original failing regressions preceded lock enforcement, text-frame lock
  enforcement, bracket lookup, border reads, overflowing size totals and
  malformed-document error classification.
- Focused domain/model/accounting run: 118 tests passed when recorded. The
  independent accounting file may subsequently grow under its owner's scope.
- Package source and test TypeScript checks passed. Root performs the maintained
  package-wide checks and byte SDK/registered CLI parity verification before
  committing explicitly owned paths.

Tests author XML entirely in memory and require no downloaded assets. The
repository's separate audit and inventories retain upstream identities and exact
parameter/BDD provenance; product files and original tests contain no such names.

Final inspection adds seven independent original cases distinguishing absent, none,
solid/theme and opaque cell/border fill kinds, with no-op byte preservation.
