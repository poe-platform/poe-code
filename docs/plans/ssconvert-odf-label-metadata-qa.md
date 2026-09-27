# ODF label metadata qualification

Tracking: hey-boss #1748. This procedure covers native label declarations and
lookup settings, quoted-label import and native OpenFormula label export.
Unqualified label exports and the complete BIFF/format family remain open.

1. Inspect the pinned LibreOffice `xmllabri.cxx`, `xmlexprt.cxx` and
   `XMLCalculationSettingsContext.cxx` receipts in the case ledger. Check the
   OASIS ODF 1.2 schema for required orientation/address attributes and its
   literal `true`/`false` boolean grammar. Do not infer XML Schema boolean syntax.
2. Run the maintained ODF codec tests and neighboring BIFF label/evaluator tests.
   Use independent native XML declarations with a quoted sheet name, duplicate
   row bindings, a column binding and an endpoint beyond row 65,536. Verify
   ordered model ranges, sparse cells, valid expanded sheet size, lookup defaults,
   strict/extended output, old OpenOffice namespaces and malformed-input refusal.
3. Build the selected ssconvert workspace closure. Through the compiled public
   SDK, export strict and extended ODF, reopen both, then convert one through
   `runCommand` to ODF and reopen that output. Independently inspect ZIP members
   and XML attributes using Python's standard library. Require matching ordered
   ranges, quoted display names rather than internal IDs, and enabled lookup.
4. After import, insert a live internal row-label SUM with stale cache 999. Put
   values 2 and 3 at opposite ends of its declared data interval with a blank
   gap. Require fresh result 5. This proves model binding, not native formula
   syntax. Separately transport BIFF8-compatible declarations through ODF and
   back to native BIFF8 records and compare them.
5. Inspect an actual command screenshot for the existing CSV label-loss warning
   and unchanged CSV values. Record additional diagnostics as defects. The
   repeated-export page-layout warning was repaired under hey-boss #3627.
   Verify an independent ODF fixture with its page layout in content automatic
   styles: two strict/extended read/export/read cycles must preserve landscape
   orientation, an 11-point left margin, header/footer dimensions and passive
   background paths with no unknown-element warnings. Check the actual compiled
   SDK/command outputs with an independent ZIP/XML parser.
6. When an authenticated LibreOffice runtime is available, open and save the
   files and compare native `XLabelRanges` label/data areas, order and lookup
   setting. Native runtime absence is an unresolved qualification dependency.
7. Keep cross-sheet label/data declarations, live formula identity, inferred
   BIFF forms and native application readback open. Verify remote main and
   publication separately; purge scratch outputs after reducing evidence.

8. Read OpenFormula 1.2 section 5.10 and the pinned Calc `ParseColRowName`
   implementation before changing quoted-label binding. Construct a small ODF
   package with `of:=SUM('Sales')` on Output, stale cache 999, and a later Data
   sheet containing Sales at A1, 2 at A2 and 3 at A5. Declare Data.A1 as a column
   label for Data.A2:A5 and disable automatic lookup. Through the compiled SDK,
   require a live internal anchor and fresh result 5; renaming the label text
   must retain that anchor. Exercise formula-only cells, array groups, repeats,
   local named expressions, unresolved labels, lookup accounting and cancellation.
   Convert the independent input with both `engine.convert({ recalc: true })`
   and `runCommand --recalc` to CSV; independently parse each CSV and require 5.
   Inspect the captured command transcript as a terminal screenshot. A cached
   formula-generated label value is not native recalculation evidence. Keep
   unqualified automatic-lookup profiles, locale-specific text matching,
   duplicate declarations across remote sheets, mixed relative-sheet formulas
   and all unqualified export/native profiles open.

9. Qualify automatic lookup with no declarations and the default-enabled setting.
   Use Sales at A1, blank A2, 1 at A3, 2 at A4, blank A5, 8 at A6, blank A7,
   and 32 at A8. Put `SUM('Sales')` at F6 with stale cache 999. The imported
   formula must keep OpenFormula range semantics and return 3; setting A5 to 4
   through the SDK and command must return 15. A neighboring cell must not bridge
   a blank in the label's data column. Verify row-label transposition, two initial
   blanks, sparse large sheets, current-sheet-only automatic lookup, declarations
   taking precedence, direction/distance ties and copy/move identity. Check
   `ABS('Sales')` at F6 with 2 at A2, blank A3 and -8 at A6: scalar result 8,
   aggregate result 2. Native BIFF export must not discard OpenFormula semantics;
   its identity-preserving transport remains open. Use the compiled SDK/command,
   independent CSV inspection and a captured command screenshot before delivery.

10. Read OpenFormula sections 5.2 and 5.10.6 and Calc's automatic-intersection
    lowering before changing `!!`. Use a Python ZIP/XML fixture declaring Sales
    at B1 as a column label for B2:B6 and West at A3 as a row label for B3:D3.
    Put 7 at B3 and `of:='Sales'!!'West'` at H8 with stale cache 999. The compiled
    SDK and command must return 7, then 19 after setting B3, and retain the
    captured anchor after renaming Sales. Independently parse all six CSVs and
    inspect the actual command transcript screenshot. Check either operand
    order, automatic lookup, same-axis/disjoint/cross-sheet errors, copy/move,
    deleted anchors and precedence beside range/postfix operators. Reject native
    syntax with references, calls, parenthesized operands or chained `!!`.
    Internal deleted-anchor syntax must not escape into native Gnumeric/ODF
    formula exports. Unqualified exports and native application readback remain
    open.

11. Inspect pinned Calc `CreateStringFromSingleRef` at lines 6026–6059. Native
    ODF label output quotes the current cell text with doubled apostrophes;
    verify that native lookup selects the original anchor and axis before export.
    Construct an independent Python ODF package on sheet `O'Brien`, with Sales
    at B1, West at A3, 7 at B3, a live `!!` at H8 and a named label Total based
    at H8 and consumed at H3. Export strict and extended ODF using both compiled
    SDK and command, with and without renaming Sales to `O'Brien Sales` and
    setting B3 to 19. Independently inspect all eight ZIP/XML outputs: native
    quoted formulas, named-expression rather than named-range, and base H8.
    Reopen/recalculate and independently parse all sixteen H3/H8 CSV outputs:
    require 7 before edits and 19 afterward. Verify automatic range gaps,
    remote declarations, array groups and copy/move in maintained tests.
    Rename Sales to conflicting West and require export failure with the prior
    destination unchanged. CLI `--set` takes literal text after the first equals;
    quoting that text inside an already formed argv value changes the cell text.
    Inspect the actual command transcript screenshot and purge generated files.
    Keep non-text/formula-generated/deleted labels, ambiguous rebinding,
    mixed relative-sheet expressions, BIFF-specific reference classes and
    native application qualification open.

12. Inspect pinned Calc `ScCompiler::CheckTabQuotes`, `ScAddress::Format` and
    `ScRangeStringConverter::GetStringFromAddress` before changing other ODF
    addresses. Build independent Gnumeric XML style regions at H8:H9 with
    conditional and validation expressions `A1>0`. Use sheet names `Sheet 1`,
    `O'Brien`, `Path\Data` and `'O'Brien'`. Convert each through compiled SDK
    and command into strict and extended ODF, then repeat each conversion.
    Independently inspect all 32 ZIP/XML outputs: both base addresses retain
    H8 and the exact sheet name, apostrophes double, backslashes remain literal,
    relative formula A1 and cell A1's value 3 survive. Require no diagnostics.
    Inspect the command transcript screenshot and purge generated artifacts.
    This checks exported syntax and retained metadata; native application
    evaluation of conditional formatting and validation remains unqualified.

13. Inspect Calc `tabvwsh3.cxx` address/range parsing and URL decoding, plus
    Gnumeric `odf_write_link_start` and `oo_cell_content_link`. Hyperlink
    fragments use unbracketed addresses. Construct Gnumeric XML with real
    destinations for `Bang!`, `O'Brien`, `Q.1`, `Path\Data` and `Rate%20` sheets,
    absolute cell ranges, global/local Total names and an unchanged HTTPS link.
    Export strict/extended ODF through compiled SDK and command. In a second
    conversion edit every link's display text, forcing regenerated paragraphs.
    Independently parse all eight ZIP/XML packages: require the same 64 targets,
    correct escaping, retained destinations and updated display text. In unit
    fixtures cover both style-region links and cell-only links. Inspect the
    command transcript screenshot. Native navigation, ambiguous dotted names,
    non-A1 marks and unqualified application profiles remain open.
