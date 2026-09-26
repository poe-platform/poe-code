# BIFF document-property qualification

Use the current compiled ssconvert workspace. Keep generated workbooks, screenshots,
source captures and logs under `out`; remove them after recording compact evidence.

1. Inspect the pinned LibreOffice `oleprops.cxx`, `docinf.cxx`,
   `comphelper/source/misc/string.cxx` and `include/o3tl/string_view.hxx` receipts in
   `docs/ssconvert/gap-resolution.json`. Confirm the section GUIDs, relative offsets,
   UTF-8 codepage, dictionary layout, padding, FILETIME and keyword rules.
2. Export one original workbook through BIFF7, BIFF8 and dual-stream writers. Include
   Unicode title/author/company, keywords, creation time, elapsed editing time and
   custom integer/double/boolean/text properties. Reopen through the public engine.
3. Independently read each export with SheetJS `@e965/xlsx` and inspect its CFB streams.
   Compare document properties and worksheet cells. Record mismatches separately:
   SheetJS 0.20.3's custom-property BOOL reader recognizes only `1`, while LibreOffice
   writes signed 16-bit `-1`. Verify `ffff0000` on disk; do not change valid output or
   count that reader mismatch as a pass.
4. Run the actual ssconvert CLI formatter against Gnumeric XML containing a keyword
   with an embedded comma. Inspect a terminal screenshot of its explicit export-loss
   warning and confirm the conversion still publishes a valid workbook. Confirm exactly
   one specific warning appears; unknown wrapper content and records already marked
   as dropped must still produce their generic metadata-loss warning.
5. Cross-read fresh exports with LibreOffice and Gnumeric when the native runtimes are
   available. Check saved properties independently of worksheet values. Native GUI
   access and screenshots must be executed before claiming application qualification.
6. For encrypted workbook profiles, verify properties remain separate plaintext
   streams and the workbook still requires the supplied password. Keep encrypted
   ancillary-property support open; the existing refusal is not an implementation.
7. Qualify preservation of unknown property types, sections and timestamp precision
   across edits and reexports. Current raw retention and export warnings do not prove
   that unsupported metadata round-trips.
