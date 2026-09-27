# ODF label metadata qualification

Tracking: hey-boss #1748. This procedure covers native label declarations and
lookup settings, not live formula transport or the complete BIFF/format family.

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
   current repeated-export page-layout warning has separate follow-up tracking.
6. When an authenticated LibreOffice runtime is available, open and save the
   files and compare native `XLabelRanges` label/data areas, order and lookup
   setting. Native runtime absence is an unresolved qualification dependency.
7. Keep cross-sheet label/data declarations, live formula identity, inferred
   BIFF forms and native application readback open. Verify remote main and
   publication separately; purge scratch outputs after reducing evidence.
