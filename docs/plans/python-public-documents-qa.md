# Public Python document integration and manual QA

The maintained acceptance entry is
`packages/safe-bash/tests/integration/pyodide-runtime/public-documents.test.mjs`.
It imports built `poe-code/safe-bash` public exports, the public Python worker
factory and canonical `poe-code/safe-fs/core` memory storage. Both memory and
asynchronously delayed storage run identical ordinary create, edit and verify
Python script files through `python` and `python3`. Packages use the configured
`documents` profile and an explicitly preprovisioned offline cache. This is a
real-runtime integration suite, outside fast unit discovery; it never downloads.

## Execute and capture

1. Run the maintained root `npm run build` and the separately maintained Python
   provisioning route. Set `SAFE_BASH_PYTHON_CACHE` to its absolute cache directory.
   `SAFE_BASH_PYODIDE_RUNTIME_URL` optionally selects an explicitly provisioned
   loader; the default is the isolated pinned integration Pyodide installation.
2. Run the maintained Python acceptance route. To retain document render inputs,
   set `SAFE_BASH_PYTHON_ARTIFACT_DIR` to a new absolute output directory. Capture
   is opt-in and outside units. Each profile refuses to overwrite existing capture
   directories and each artifact uses exclusive creation. Ordinary acceptance
   retains artifacts only in canonical memory storage.
3. Render the captured memory `report.docx` using the documents skill's
   `render_docx.py INPUT --output_dir NEW_DIRECTORY --emit_pdf`. Inspect every
   page PNG for title, heading, table, image, edit paragraph, clipping and overlap.
4. Use the external LibreOffice headless executable to open/export both XLSX
   files to a fresh PDF output directory. Render those PDFs with `pdftoppm` and
   inspect values, blue header style, formula result, chart and image. Compare
   native export results with stored values; exporting may calculate formulas.
5. Render `report.pdf` and `edited.pdf` with `pdftoppm`; inspect all pages. Use
   `pdftotext`, `pdfinfo` and `pdffonts` as independent readers to check text,
   page counts and embedded font status. Keep raw command results and screenshots
   in a new output directory. Never replace historical captures.
6. Record command results, versions, paths and actually inspected screenshots
   below. An unavailable renderer or missing check remains incomplete.

## Assertions and boundaries

- DOCX: title, heading style, table cell edit, embedded image and fresh-interpreter
  reopen. Independent ZIP/XML reading validates the table and media member.
- XLSX: both openpyxl and XlsxWriter create values, styles, formulas, charts and
  images. openpyxl independently reopens XlsxWriter output, edits both workbooks
  and reopens again; ZIP/XML also checks formula and chart/media storage.
- XlsxWriter's initial formula cache is explicitly supplied as 5. After openpyxl
  editing, formulas remain stored while cached results are absent. Neither case
  proves a Python formula calculation engine. External spreadsheet export may
  calculate and is recorded separately.
- PDF: fpdf2 writes two pages, a raster image, Helvetica and an embedded TrueType
  font from the repository's existing terminal font asset. pypdf independently
  reads it, writes an edited one-page artifact, and verifies text, page count,
  image, metadata and font resources. External Poppler adds another reader.
- Temporary files, seek-from-end, overwrite and truncate use canonical `/tmp`;
  deleted temporary files leave no entries. Host input and subsequent host edits
  reach Python; guest binary/document/text effects reach the host and shell.
- Passing these document cohorts is not full Python/Bash compliance. It does not
  certify arbitrary document features, network backends, PDF rendering inside
  Pyodide or Word-to-PDF conversion inside Pyodide. DOCX writing and external
  Word-compatible rendering are separate workflows.

## Actual evidence

Execution on 2026-09-13 (America/Chicago), live working tree, Node 22.23.2,
Pyodide 314.0.6 / CPython 3.14.2. Root coordinated the successful `npm run build`;
the package profile was provisioned separately into
`output/python-public-integration-20260913/cache`.

- First document acceptance: 2/2 profiles passed, zero skips/TODOs, 42.2 seconds;
  raw log `/tmp/python-public-documents.log`. Initial artifacts and renders remain
  under `output/python-public-integration-20260913/documents`, `render-docx`,
  `render-xlsx` and `render-pdf`.
- External spreadsheet inspection found chart content split across print pages.
  The fixture now explicitly sets landscape and fits its print area to one page.
  This was a fixture print-layout defect, not evidence of bridge corruption.
- Current fixture acceptance: 2/2 profiles passed, zero skips/TODOs, 44.3 seconds;
  raw log `/tmp/python-public-documents-v2.log`. Each profile runs create, independent
  formula-cache read, edit and verification in four fresh interpreter invocations.
  No configured package network transport was invoked.
- Current artifacts: `output/python-public-integration-20260913/documents-v2/`,
  with separate `memory/` and `delayed/` copies. Only memory copies were externally
  rendered; both profiles received the same structural assertions.
- Current inspected screenshots under `output/python-public-integration-20260913/`:
  `render-docx-v2/page-1.png`; `render-xlsx-v2/openpyxl-1.png` and
  `render-xlsx-v2/writer-1.png`; `render-pdf-v2/report-1.png`, `report-2.png`
  and `edited-1.png`. All six were visually inspected. The DOCX title, heading,
  edited table cell 73, image and final paragraph are visible. Both workbooks show
  7, 3 and externally calculated 10, a blue header, intact chart and image on one
  landscape page. The PDF pages show the expected heading/image and second-page
  text; the edited PDF retains its first page. No clipping or overlapping content
  was observed after the print-layout correction.
- External readers: LibreOfficeDev 26.8.0.0.alpha0
  (`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`) reopened DOCX and XLSX;
  Poppler 26.08.0 rendered/extracted PDF. `pdfinfo` reported original PDF 2 pages,
  edited PDF 1 page, each corrected spreadsheet PDF 1 page.
  `pdffonts` identified unembedded standard Helvetica and embedded subset
  JetBrainsMono CID TrueType with Unicode mapping. `pdftotext` independently read
  the expected edited PDF text and spreadsheet values 7, 3, 10.
- Raw render logs: `/tmp/python-public-render-docx-v2.log` and
  `/tmp/python-public-render-xlsx-v2.log`. LibreOffice emitted fontconfig cache
  warnings but both exports succeeded. Source syntax and `git diff --check`
  passed. Root owns the maintained cross-workspace unit/lint and suite evidence.

This evidence establishes only the listed document workflows. Formula calculation
inside Pyodide, Word-to-PDF conversion inside Pyodide, arbitrary document fidelity,
and full Python/Bash compatibility remain unproven. These gaps are not counted as
passes. No new visible CLI behavior was introduced by this document test slice;
root owns CLI checks for the wider change.
