# Live table model evidence

The format package owns table-model.ts. SDK-backed model writes use the shared
admitted ModelStore and DocumentXmlEditor; there is no second archive/editor owner,
ambient filesystem access, native execution or implicit network. Original tests
use memfs and small authored XML. Reference-project names and copied fixtures are
absent from implementation, comments and tests.

## Verified language and security mappings

| Audited public surface | JavaScript mapping and behavior |
| --- | --- |
| Table | Shared-owner constructor; part and element inherited views; synchronous add_row, add_column, cell, row_cells, column_cells, rows, columns, style, alignment, autofit and table_direction. |
| _Cell | Public returned owner; part, element, table, add_paragraph, add_table, grid_span, iter_inner_content, merge, paragraphs, tables, text, vertical_alignment and width. Direct paragraph/table traversal retains order; descendant paragraphs are excluded. Whole text delegates to the shared guarded replacement operation. |
| _Row | cells, table, part, element, grid_cols_before, grid_cols_after, height and height_rule. Height and rule null setters clear their own attribute independently. |
| _Column | cells, table, part, element and nullable width; declared width uses EMUs/Length views and exact stored twips. |
| _Rows / _Columns | Public underscore spellings retained; zero-based at(index), negative indexes, length and Symbol.iterator; inherited table/part; _Rows.slice(start,end) uses JS exclusive-end slicing. Invalid or omitted positions throw bounds errors. |
| Merged cells | Horizontal grid spans and vertical continuation slots return the same logical cell owner. Omitted grid slots remain absent; empty present cells retain empty text. Columns exclude absent slots and repeat merged aliases. |
| Nested content | iter_inner_content yields direct paragraph and table owners in stored order. add_table uses admitted geometry and the shared creation engine, including the terminal cell paragraph. |
| Formatting | Existing neutral enum family names and aliases remain in formatting-values.ts. Table direction is table_direction; no historical direction alias is invented. Nullable properties remove inherited overrides. |
| Styles | Existing shared live TableStyle is returned and accepts existing style names, TableStyle values or null. Style edits and table edits persist through one shared document save. |
| Merge and column insertion | Rectangle merge reuses editMergedTable and preserves rich block order. Ambiguous legacy horizontal merges and nonrectangular/merged column insertion reject explicitly. No layout or external field evaluation is performed. |

The pinned inventories and audit remain historical research. This evidence
qualifies live table owners and original semantic cases, not the complete
section/review task or the whole DOCX format. No API is excluded because its type
name starts with an underscore. Inherited style formatting remains provided by
the existing shared style owner; no competing identity-only style view is used.

## Verification

Eleven original fast tests passed, including absent versus empty slots, repeated
logical aliases, nested ordered content, nullable table/row/column properties,
row/column additions, paragraph-order merge and shared live style/text save/reopen and cross-owner paragraph-style rejection. Detached cell metadata after merge,
and table/cell/row/column/collection metadata after owner removal reject through
the stale-handle guard; the metadata test failed before guard implementation.
The initial five semantic failures and later independent null-height failure were
observed before implementation. Owned ESLint and TypeScript checks passed; the
coordinator records maintained package checks and commits. The Table.table self-owner regression failed before its getter was added.
Model-only changes do not alter CLI visuals.

## Per-member inventory overlay

The exact pinned table namespace contains 52 rows: 51 public class/member/protocol
rows and one explicit historical documentation-error row. They remain historical
inventory rows; this overlay records current JS mappings without rewriting their
identities. T1–T11 identify these original cases in table-model.test.ts:

| Case | Exact original test name |
| --- | --- |
| T1 | distinguishes absent row slots from empty cells and repeats merged logical owners |
| T2 | keeps direct nested paragraph and table order without flattening descendants |
| T3 | mutates nullable table, row and column formatting while preserving other properties |
| T4 | adds a row and column using declared widths and preserves existing values |
| T5 | merges a rectangle with ordered paragraph content and common logical aliases |
| T6 | retains live owners across row/column insertion and persists table styles with the shared document |
| T7 | clears row height and rule independently without discarding the other attribute |
| T8 | rejects a paragraph style from another owner before inserting a cell paragraph |
| T9 | returns its own public table owner |
| T10 | exposes inherited table views, formatting, collection slicing and nested creation |
| T11 | rejects metadata and owner traversal from detached table owners |

| Inventory member | Exact JS signature/property mapping | Original case |
| --- | --- | --- |
| Table | constructor(store:ModelStore,ref:ModelRef) | T1,T10 |
| Table.add_column | add_column(width:DocxLength):_Column | T4,T6 |
| Table.add_row | add_row():_Row | T4,T6 |
| Table.alignment | alignment:DocxEnumValue<"WD_TABLE_ALIGNMENT">\|null (get/set) | T3 |
| Table.autofit | autofit:boolean (get/set) | T3 |
| Table.cell | cell(row_idx:number,col_idx:number):_Cell | T1,T5 |
| Table.column_cells | column_cells(column_idx:number):_Cell[] | T1 |
| Table.columns | columns:_Columns (get) | T1,T4 |
| Table.row_cells | row_cells(row_idx:number):_Cell[] | T10 |
| Table.rows | rows:_Rows (get) | T1,T4 |
| Table.style | style:TableStyle\|null (get); string\|TableStyle\|null (set) | T6 |
| Table.table_direction | table_direction:DocxEnumValue<"WD_TABLE_DIRECTION">\|null (get/set) | T10 |
| _Cell | constructor(store:ModelStore,ref:ModelRef,table:Table) | T1,T10 |
| _Cell.add_paragraph | add_paragraph(text='',style:string\|ParagraphStyle\|null=null):Paragraph | T8,T10 |
| _Cell.add_table | add_table(rows:number,cols:number):Table | T10 |
| _Cell.grid_span | grid_span:number (get) | T1,T5 |
| _Cell.iter_inner_content | iter_inner_content():Iterable<Paragraph\|Table> | T2 |
| _Cell.merge | merge(other_cell:_Cell):_Cell | T5 |
| _Cell.paragraphs | paragraphs:Paragraph[] (get) | T2,T10 |
| _Cell.tables | tables:Table[] (get) | T2,T10 |
| _Cell.text | text:string (get/set) | T2,T6,T10 |
| _Cell.vertical_alignment | vertical_alignment:DocxEnumValue<"WD_CELL_VERTICAL_ALIGNMENT">\|null (get/set) | T10 |
| _Cell.width | width:Length\|null (get); DocxLength\|null (set) | T3,T10 |
| _Row | constructor(table:Table,ref:ModelRef) | T1,T10 |
| _Row.cells | cells:readonly _Cell[] (get) | T1,T10 |
| _Row.grid_cols_after | grid_cols_after:number (get) | T1 |
| _Row.grid_cols_before | grid_cols_before:number (get) | T1 |
| _Row.height | height:Length\|null (get); DocxLength\|null (set) | T3,T7 |
| _Row.height_rule | height_rule:DocxEnumValue<"WD_ROW_HEIGHT_RULE">\|null (get/set) | T3,T7 |
| _Row.table | table:Table (get; Table returns self) | T9,T10,T11 |
| _Column | constructor(table:Table,ref:ModelRef) | T1,T10 |
| _Column.cells | cells:readonly _Cell[] (get) | T1,T10 |
| _Column.table | table:Table (get; Table returns self) | T9,T10,T11 |
| _Column.width | width:Length\|null (get); DocxLength\|null (set) | T3,T10 |
| _Rows | constructor(table:Table) | T1,T10 |
| _Rows.table | table:Table (get; Table returns self) | T9,T10,T11 |
| _Columns | constructor(table:Table) | T1,T10 |
| _Columns.table | table:Table (get; Table returns self) | T9,T10,T11 |
| Table.part | part:XmlPartView (get; inherited owner) | T10,T11 |
| Table.table | table:Table (get; Table returns self) | T9,T10,T11 |
| _Cell.part | part:XmlPartView (get; inherited owner) | T10,T11 |
| _Row.part | part:XmlPartView (get; inherited owner) | T10,T11 |
| _Column.part | part:XmlPartView (get; inherited owner) | T10,T11 |
| _Rows.part | part:XmlPartView (get; inherited owner) | T10,T11 |
| _Rows.__getitem__ | at(value:number):_Row; slice(start=0,end=length):_Row[] | T1,T10 |
| _Rows.__iter__ | [Symbol.iterator]():Iterator<_Row> | T1,T10 |
| _Rows.__len__ | length:number (get) | T1,T4 |
| _Columns.part | part:XmlPartView (get; inherited owner) | T10,T11 |
| _Columns.__getitem__ | at(value:number):_Column | T1,T10 |
| _Columns.__iter__ | [Symbol.iterator]():Iterator<_Column> | T1,T10 |
| _Columns.__len__ | length:number (get) | T1,T4 |
| Table.direction | documentation error D03: no direction alias; table_direction replacement | T10 |

The row for inherited _Cell.iter_inner_content maps the audited block-container
member. part rows retain their inherited story/parent-owner obligations. The
underscore class names remain publicly exported.
Collection indexing uses explicit JS at/slice methods; collection iteration and
length map the inventoried protocols rather than disappearing from scope.

## Source-case candidate counts

The pinned unit inventory contains 150 tests/test_table.py parameter-expanded
candidate cases: 41 Table, 39 Cell, 40 Row, 13 Column, 14 Rows and 3 Columns cases.
The table-named BDD source-file filter contains five expanded candidates: two
block add-table, two document add-table and one cell add-table case. These are
candidate counts, not 155 claimed implemented tests or an assertion that all
applicable source behavior has been individually reconciled. The original eleven
cases reduce semantic boundaries into tiny authored assets; upstream mocks,
incidental fixture strings and binaries are not copied. Other source files can
contain table-related cases; the exact counting filter is disclosed above rather
than presenting these counts as whole-format completeness.
