Original workbooks from LibreOffice/core at
`86090b9bfc1b38bb09f9110b8acad27abdf373f0`, distributed under MPL-2.0
(see the spreadsheet engine's LICENSE.LibreOffice).

- `tdf142579.xlsx`, `tdf142580.xlsx`: `sc/qa/uitest/data/autofilter/`;
  assertions from `sc/qa/uitest/autofilter/colorfilter.py`.
- `autofilter-colors.xlsx`, `autofilter-colors-fg.xlsx`, `tdf145057.xlsx`:
  `sc/qa/unit/data/xlsx/`; assertions from `sc/qa/unit/subsequent_export_test2.cxx`
  and `sc/qa/unit/subsequent_export_test5.cxx`.

Files are copied unchanged. Tests cover saved visibility, fill/font filter
criteria, and preservation through JSON and XLSX export/reimport.
