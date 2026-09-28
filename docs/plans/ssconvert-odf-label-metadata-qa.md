# ODF label metadata qualification

Tracking: hey-boss #1748. This procedure covers native label declarations and
lookup settings, quoted-label import and native OpenFormula label export.
Unqualified label exports and the complete BIFF/format family remain open.

Range/mixed-reference follow-up (#3654): read pinned Calc `compiler.cxx`
5924–5954 and `include/formula/opcode.hxx` 91–109 before repairing range
serialization. `ocRange` is a binary operator; parentheses around a label can
change scalar selection. Compare `'Sales':[.B5]` with `('Sales'):[.B5]` at a
formula row inside the declared data range, using different values above that
row. Internal serialization must preserve each result and the captured anchor,
not merely become parseable. Also import and export a quoted label combined
with `[Other.B2]`: retain relative-sheet copy/move behavior, label renames,
named/array expressions and `!!`. Native ODF output must use quoted label text
and ordinary bracket references; explicit native parsing must reject internal
anchor syntax. Verify strict/extended compiled SDK and command readbacks and
independently inspect ZIP/XML. Native application qualification remains separate.

Formula-result label follow-up: inspect the pinned Calc `IsValue`, `GetString`,
`NeedsInterpret` and `MaybeInterpret` sources recorded under
`reference.biffLiveLabelRangeAudit.odfLiveLabelExport.formulaResultLabels`.
Through compiled SDK and command routes, export a declared label whose dirty
formula changes Sales to New Sales. Independently inspect the ODF formula and
label-cell cache, reopen/recalculate to 5, then edit the declared data interval
and verify the live anchor still responds. Cover strict/extended output,
clean/manual caches, dirty matrix labels, textual source formulas, shared host
dependencies called once, unrelated dirty host formulas left unevaluated,
competing labels, non-text/circular results, cancellation and work limits.
Inspect the command transcript screenshot. Native Calc readback and wider
iteration/post-import profiles require separate evidence; do not count cached
string transport as native recalculation qualification.

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

14. Read Calc `MakeRangeFromName` and Gnumeric `gnm_hlink_cur_wb_set_target`
    before handling Calc's `Total (Sheet)` hyperlink marks. Build an independent
    ODF package with Links first, later `O'Brien`, `Data (Q1)` and Data sheets,
    local Total names, and a separate global Total=999. Disable automatic label
    lookup in this fixture to isolate hyperlink conversion. Import URI-encoded
    local marks, including case variation, and export native Gnumeric XML via
    SDK and command. Independently verify three qualified name targets and all
    four name definitions. Reexport both XML outputs to strict/extended ODF
    after editing the link text; require all named targets to survive. Verify
    missing sheets and malformed marks remain passive text. Native Calc accepts
    UI mark notation while Gnumeric exports qualified-expression notation;
    do not claim native navigation from these transport checks alone.

15. Follow Calc's `SID_JUMPTOMARK` call to `MakeRangeFromName` before exporting
    sheet-local named links. Construct Gnumeric XML with Links first, four later
    sheets named Data, `O'Brien`, `Data (Q1)` and `Path\Rate%20`, local Total
    ranges at A1 with distinct values, and global Total pointing to Links.B1=999.
    Export using compiled SDK and command, strict and extended ODF; reopen and
    edit all five link texts before exporting again. Independently parse all
    eight packages and decode URI fragments: local targets must be
    `#Total (Sheet)`, with literal sheet names, and the global target `#Total`.
    Require the local/global declarations and values to remain distinct. Decode
    `text:s` when comparing display text. Cover both style-region and cell-only
    exports in memory tests, and preserve missing-sheet passive targets.
    Inspect the actual command transcript screenshot. This verifies the native
    dispatch spelling and transported identity; actual Calc and Gnumeric
    navigation, relative-name cursor behavior and ambiguous dotted globals
    remain separate application qualifications.

16. Repeat the local-name conversion with native ODF input containing unchanged
    rich text: a bold span with `#Data.Total`, `#Total`, `#Data.A1`, a missing
    sheet, a malformed percent escape, an HTTPS URL and an already native
    `#Total%20(Data)` target. Export directly through compiled SDK and command
    into both ODF profiles. Independently verify that only `#Data.Total` changes,
    all seven links survive, and text, spaces, nested spans and bold styles remain.
    Exercise both top-level and nested links in memory tests; keep depth, cycle,
    namespace and resource guards intact. Inspect the command transcript and
    purge the four generated packages after recording their observations.

    For unchanged hyperlink labels, compare ODF 1.2 `text-a`/`paragraph-content`
    with Calc's `ScXMLCellFieldURLContext`. Independently construct direct and
    outer-bold-span hyperlinks containing leading/repeated/trailing `text:s`,
    `text:tab` and `text:line-break`, with ordinary text before and after them.
    Verify the import retains LF, then export through compiled SDK and command
    in both ODF profiles. Require native CSV readback to preserve exact spaces,
    tabs and line breaks, and independent XML inspection to retain outer styles.
    Check zero/default counts, pre-allocation work/output bounds, additional
    semantic attributes and input identity. Styled children inside hyperlinks
    and actual navigation require separate native qualification.

17. Inspect Calc `ScLabelRangesObj::addNew` and `GetRefColRowNames`: declared
    pairs retain the data sheet and project the label's physical column/row,
    without rectangle-offset mapping. Construct independent ODF column/row
    fixtures with Labels first, data on `O'Brien`, stale Output caches of 999,
    wrong-sheet values and blank data gaps. Through compiled SDK and command,
    export both ODF profiles before and after inserting 10 into a former gap.
    Put the data sheet first in edit inputs for the native `--set` active-view
    contract; use A3 for the column case and C1 for the row case.
    Independently parse all 16 outputs: require distinct label/data addresses,
    live quoted formulas, sum 5 then 15, and scalar 2. Exercise forward IDs,
    target grid bounds, remote dependencies without volatile queuing, names,
    arrays, independent owner/data resizing, rename, tab move, ID remapping and
    detached owners in memory tests. BIFF8 must refuse remote data even when its
    coordinates match its inferred interval; ODF must refuse an unexported data
    sheet. Inspect the command transcript screenshot, record compact receipts
    and remove generated packages. Native application recalculation remains a
    separate qualification.

    Refresh native qualification through the compiled public entry as well as
    source execution. Replace only formula caches/display paragraphs with 999;
    preserve the OpenFormula namespace even when no XML element uses its prefix.
    Require Calc to recompute both profiles/routes before and after edits. For
    the row case place the numeric scalar at B2, inside B:E; retain A2 as a
    separate out-of-range control returning #REF!. Independently read native
    XLSX sheet relationships and values. Verify an original input in Calc, keep
    compact hashes/observations, then remove workbooks and native profiles.

18. Audit Calc's automatic-boundary loops separately from explicit data binding:
    the pinned global pair list has no data-sheet filter. Put an automatic A1
    label and values 10/20/30 on Local, and a declared label/data pair on Remote
    whose data interval starts at row 3 (transpose for a row label). Require
    Calc/BIFF SUM to stop at 10; OpenFormula's contiguous range still sums 60.
    Cover both declaration owners and omitted/local/remote data identities.
    Through compiled SDK and command, convert a BIFF8 workbook carrying the
    remote declaration to CSV and independently inspect the result and untouched
    local values. Record that these BIFF inputs are product-writer-seeded and
    that native application recalculation remains unqualified.

19. For absolute-sheet hyperlink marks, inspect Calc `address.cxx` 1248–1296:
    consume `$` before the quoted or unquoted sheet token. Import `$Sheet1`,
    `$'Sheet 1'`, `$'O''Brien'`, URI-encoded markers and `$'$Revenue'` alongside
    literal `'$Revenue'`, ordinary references and an external URL. Independently
    author the ODF input with distinct destination values and automatic label
    lookup disabled. Convert through compiled SDK and command to Gnumeric XML,
    then edit every display string and reexport strict/extended ODF. Independently
    inspect all targets, destination names/values and changed text. Require no
    diagnostics, no input changes and unprefixed exported sheet syntax. Use the
    stable imported sheet ID for SDK updates. Inspect the command transcript
    screenshot; keep native navigation qualification separate and purge outputs.
