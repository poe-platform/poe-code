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
