# Bounded DOCX table construction

Scope: the `table-construction` task only. Neighboring table editing, merged-cell,
model adaptation and whole-public-API tasks are not completed by this record.

The current engine already implements explicit positive rows/columns, rectangular
typed content, grid widths, fixed/automatic layout, consecutive leading repeated
headers, borders/shading, table and cell margins, row splitting/height, and required
terminal cell paragraphs. `tables.add` delegates to the paragraph insertion engine;
structured creation uses the same content renderer. This verification introduces
no product-code change and claims no new failing-test-before-code implementation.

Original in-memory tests in `packages/docx/src/table-construction.test.ts` cover
empty cells, Unicode carets, nested tables, strict/transitional XML, retained
section properties, invalid requests before output, and aggregate cell limits.
Additional independent assertions qualify the indivisible 101-twip three-column
grid `[34, 34, 33]`, its cell widths, and a nested grid `[16, 15]` after subtracting
one and two twips of cell margins. Both fixed and automatic layout are exercised.
All output mutations use memfs; no downloads or native reference execution occur.

A multi-story insertion probe failed with the documented usage rejection for
`all`, rather than establishing an aggregate-limit defect. It was not retained
as a product issue or used to justify changing supported insertion cardinality.

## Exact utility and language/security mappings

| Surface | JavaScript mapping and boundary |
| --- | --- |
| Utility insertion | `editDocumentTables(input: Uint8Array, request: TableConstructionRequest, context: PublicationContext): Promise<TableEditData>`; operation `tables.add`, camelCase typed options, one selected story/cell/paragraph or collapsed paragraph range. |
| CLI parity | `docx tables add INPUT --rows N --cols N`; the same validated options support direct geometry/format flags and typed content JSON/VFS input. Existing generated schema/capabilities retain the bounded edit disposition. `all` is inapplicable to insertion. |
| Widths and row counts | Explicit finite typed lengths convert to integer twips; columns match the rectangular grid and sum to its positive bounded width. Rows/columns are positive safe integers; tableCells reservations accumulate through nested and sibling content. |
| Content and ownership | Ordered paragraph/table blocks reuse insertion primitives, preserve surrounding section data, and retain terminal cell paragraphs. Document settings are not accepted inside insertion content. No implicit layout, host fonts, files, clock or network authority. |
| Publication/errors | Async admitted bytes and supplied VFS/sinks only; validation precedes publication. Invalid formatting uses `usage`/exit 2; exceeded resource ceilings use `limit-exceeded`/exit 4. Existing common dry-run, output and stale-selection protections apply. |
| Model spellings | Neutral `Document.add_table(rows, cols, style?)`, `_Cell.add_table(rows, cols)` and `Table.table_direction` remain their primary spellings. Utility camelCase options do not add model aliases. |
| Collections/protocols | `_Rows`, `_Columns`, `_Row.cells`, `_Column.cells`, table paragraph/table collections and ordered `iter_inner_content` retain zero-based live lookup, `.length`, `Symbol.iterator`, explicit `.at`/`.slice` where supported. CLI ordinals remain one-based. This task does not change collection implementation or its coverage disposition. |
| Inherited/public owners | `Table`, `_Cell`, `_Row`, `_Column`, `_Rows`, `_Columns`, their inherited `part`/`table` and XML views remain public obligations regardless of underscore prefixes. No inventory row is hidden or promoted by this task. |
| Enums/helpers | Neutral typed row-height, table-alignment/direction and cell-alignment enums, aliases, nullable inheritance, and unit helpers retain their existing mappings. This task uses the row-height enum and explicit length values; it does not certify the entire enum/helper API. |

The pinned `upstream-api-inventory.json` is a historical research inventory, not
an implementation receipt. The later live-owner and table-BDD records referenced
by `upstream-api-audit.md` retain their separate evidence and dispositions. D03
in `upstream-api-reconciliation.md` resolves the erroneous `Table.direction`
example to `table_direction`; no alias is introduced. The missing construction
record linked by the format spec and API audit is restored here without rewriting
historical evidence or asserting full model coverage.

## Verification

- Focused construction suite: 27 passing cases, including the two additional
  indivisible-grid/nested-margin variants.
- `npm run build:workspaces -- --workspace=docx`: passed, including the selected
  workspace dependency closure.
- `npm run lint --workspace=docx`: passed ESLint and both source/test typechecks;
  one existing unused-variable warning in `operation-types.test.ts`, zero errors.
- `npm test --workspace=docx`: 245 files and 5,092 tests passed in a fresh package
  run on September 21, 2026.
- No CLI rendering changes; no new screenshot tests or visual-conformance claim.
- Local owned commits only; no push or release.
