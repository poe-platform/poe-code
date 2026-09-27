# BIFF label-range qualification

Keep source inputs, generated workbooks, screenshots and command captures under
`out`; purge completed captures after recording compact results in the gap ledger.

1. Check the pinned Calc `xicontent.cxx` and `xecontent.cxx` receipts in
   `reference.biffLiveLabelRangeAudit`. Confirm ordered row/column label lists,
   inferred data pairs and Calc's export normalization. Check `ReadUsesElfs` in
   `impop.cxx` and its workbook-global dispatch in `read.cxx` against
   the exact source paths recorded in the ledger; a worksheet occurrence must
   not enable global automatic lookup.
2. Build the ssconvert workspace. Feed the public engine an original in-memory
   BIFF8 workbook with overlapping row labels, a multi-column row-label range,
   a column-label range, USESELFS and one numeric cell. Check the ordered model
   pairs and the BIFF8 grid endpoints (65,536 rows and 256 columns).
3. Export through both `writeWorkbook` and `runCommand`. Independently extract
   the Workbook stream with SheetJS CFB and decode LABELRANGES and USESELFS.
   Require original label bytes/order, one enabled lookup record and the cell
   value. Do not count a same-reader roundtrip alone as independent evidence.
4. Exercise more than 1,027 label ranges to cross a native CONTINUE record.
   Verify that ranges survive with no label/data cells materialized. Check
   malformed counts, trailing bytes, reversed ranges, invalid columns, work and
   output limits, cancellation, and snapshot ownership.
5. Resize across a label and a data boundary. Check clipping and removal when
   either rectangle disappears. Preserve the original snapshot. Verify that
   BIFF7 and unrepresentable paired endpoints fail explicitly.
6. Convert the input to XLSX with `runCommand`, inspect a terminal screenshot of
   the explicit label-metadata omission warning, and independently read its
   numeric cell. Native label transport through XLSX/XML/ODF remains open.
7. Cross-read the native BIFF8 output in current LibreOffice/Gnumeric when those
   runtimes are available. Qualify their larger document bounds and row-label
   normalization separately from exact raw-record preservation.
8. Continue the live-label formula task: durable identity, scalar/range behavior,
   two-dimensional contiguous data regions, shared/array/name contexts,
   structural edits and formula transport. Metadata support does not complete it.

9. For live subtypes `02`, `03`, `06`, `07`, inspect the pinned
   `excform8.cxx`, `compiler.cxx`, `interpr4.cxx` and `table1.cxx` sources before
   extending behavior. Feed original byte records through the compiled SDK and
   `runCommand --recalc -T Gnumeric_Excel:excel_biff8`. Use A1="Sales", values
   2 and 3 beside/below it, a blank gap, then 100, and a formula cache of 999.
   Require scalar 2 or SUM 5. Independently extract CFB with SheetJS and decode
   FORMULA: the original six ELF bytes and fresh numeric cache must survive all
   sixteen axis/class/scalar-or-SUM/SDK-or-command exports.
10. Check declared-pair precedence, numeric undeclared anchors, scalar REF
    failures, a diagonal bridge, formula self-exclusion, named and group
    evaluation, copy/move addressing and changed-data invalidation. Filling the
    blank gap must dirty the label even with volatile queuing disabled. Verify
    scalar/range selection survives both serializer modes and unary grouping.
11. Attempt Gnumeric, XLSX and BIFF7 formula export, plus a BIFF NAME containing a
    live label. Require explicit refusal; quoted text containing `@row:$A1`
    remains ordinary text. Inspect actual command diagnostics in a screenshot.
    These refusals are unfinished transport work, not format qualification.
12. Continue native application readback, named-expression export,
    extra-data subtypes, cross-sheet label transport, remaining BIFF profiles,
    and XML/XLSX/ODF live identity transport before closing the formula family.

13. Inspect MS-XLS ColElfU and the pinned Calc importer/exporter together. Require
    all four flag combinations for subtypes 02/03/06/07: bit 14 is quoted, bit 15
    is relative for both coordinates, and bits 0..13 must hold a column <=255.
    Verify 64 compiled scalar/SUM SDK/command outputs, original token bytes and
    numeric caches. Copy/move all 32 input expressions; absolute labels stay
    fixed, relative labels follow both coordinates, and quoting survives.
    Reject mixed-axis BIFF export without changing the destination. Do not
    reproduce Calc's ignored flags or silently truncate malformed column bits.
14. Use the NameParsedFormula, SharedParsedFormula and ArrayParsedFormula receipts
    before changing group/name export. Direct ELF is forbidden in NAME and
    SHRFMLA; array records allow it and shared groups can expand to cell formulas.
    Radical's following Area record and multiple-label RgbExtra are semantic
    data, not disposable padding. Implement and qualify their preservation.

15. For radical subtype `0A`, inspect MS-XLS PtgElfRadical and its separate
    following Area/AreaErr. Test row/column labels before and after a range,
    scalar/SUM use, all three area classes and all four anchor flag combinations,
    with independent data endpoint flags. Require 192 compiled SDK/command
    exports to preserve the 15 native bytes and fresh values 2/5 from cache 999;
    gaps within the explicit area count and adjacent data outside it does not.
    Check AreaErr retains its anchor and class (undefined payload bytes may
    normalize), copy/move and case-varied sheet rename/remap, resize clipping
    and deletion, precise dirty propagation, malformed/truncated records and
    invalid adjacency. Inspect the actual CLI refusal and confirm an existing
    destination survives. Native application readback remains a separate gate.
