# Public Python document edge review

Executed 2026-09-13, America/Chicago, against the existing built public exports.
Read root and `packages/safe-bash/AGENTS.md`; used document/PDF/spreadsheet skills
for artifact QA. Root owns rebuilt production verification and cross-workspace
checks. This document records this worker's independently executed checks.

## Maintained coverage added

`documents-streams.py` is an ordinary guest script invoked with
`python3 documents-streams.py` by `public-documents.test.mjs`, after separate
create, edit and verify invocations. The explicit integration fixture inventory
also names it. Both memory and delayed canonical backends execute it.

- DOCX opens an `rb` canonical file object, writes an editable `w+b` file object,
  seeks to its beginning and verifies the edited table after reopening.
- Each XLSX is reopened, saved through `SpooledTemporaryFile(max_size=1)` with
  `/tmp` as its directory, seeks back, and retains values, formulas, charts and
  images. The size threshold forces the spool onto canonical temporary storage.
- pypdf rewrites the edited PDF through `w+b`, seeks and checks its page, text
  and image. A prior file-object reader remains open while its pages are copied.
- New document paths contain both spaces and non-ASCII characters. Guest effects
  are checked using host reads from the canonical storage. `/tmp` is empty after
  cleanup, and delayed storage has zero remaining open handles.

No production defect was found in these additional document workflows. The
existing diagnostic image is a solid pixel fixture; no new artwork was authored.

## Executed evidence

Command from repository root:

```sh
SAFE_BASH_PYTHON_CACHE="$PWD/output/python-public-integration-20260913/cache" \
SAFE_BASH_PYTHON_ARTIFACT_DIR="$PWD/output/python-public-document-followup/documents" \
node --test --test-concurrency=1 \
  packages/safe-bash/tests/integration/pyodide-runtime/public-documents.test.mjs
```

Both profiles passed, 2 tests, 0 failures/skips/TODOs, 74.659 seconds. Memory took
33.766 seconds and delayed storage 40.429 seconds. Each profile executes five
fresh Python invocations including its explicit formula-cache reader. Assets
were already provisioned; the configured offline transport throws if invoked.
Capture was explicitly enabled and is outside fast unit tests. Raw log is
`output/python-public-document-followup/acceptance.log`.

After that run, the only test change added a diagnostic counting delayed
operations and open handles. Root's final aggregate run owns confirmation of
that diagnostic and the rebuilt exports. The unused `io` import was removed.
The literal fixture inventory test passed 1/1 with no skips, and JavaScript
syntax plus `git diff --check` passed.

## External reopen and visual QA

The new memory captures were independently reopened and rendered. All six PNGs
below were actually opened and inspected:

- `output/python-public-document-followup/render-docx/page-1.png`: title,
  heading, table with edited value 73, diagnostic image and edit paragraph.
- `output/python-public-document-followup/render-xlsx/openpyxl-1.png` and
  `writer-1.png`: values 7 and 3, formula result 10, blue header style, intact
  bar charts and diagnostic images on one page each.
- `output/python-public-document-followup/render-pdf/report-1.png`,
  `report-2.png` and `edited-1.png`: expected text, first-page image, second-page
  embedded-font text and one-page edited result.

No clipped text, broken chart/image or overlapping content was observed. These
are intentionally small functional diagnostic fixtures, not designed reports.
The DOCX was rendered using the documents skill's `render_docx.py --emit_pdf`.
Both XLSX files were exported externally using bundled LibreOffice headless;
Poppler `pdftoppm` rendered their PDFs and both fpdf2/pypdf artifacts.
Render logs are `render-docx.log` and `render-xlsx.log` in the same output root.
LibreOffice printed fontconfig cache warnings but exports succeeded.

Poppler independently reported original PDF 2 pages and edited PDF 1 page.
`pdftotext` read both expected text strings, and the edited PDF title is
`Reopened canonical PDF`. `pdffonts` reported standard unembedded Helvetica
plus embedded subset JetBrainsMono CID TrueType with Unicode mapping.
LibreOfficeDev is 26.8.0.0.alpha0; Poppler is 26.08.0. Captures for the delayed
profile have the same maintained structural assertions but were not separately
rendered.

## Limits retained

The XLSX formula is stored by Python; XlsxWriter initially supplies cached 5,
while openpyxl's later edit leaves no cached result. LibreOffice calculated 10
externally. This does not establish formula calculation inside Pyodide.
DOCX writing/reopening works here; Word-to-PDF conversion occurred externally,
and no renderer was executed inside Pyodide. Arbitrary document fidelity,
all malformed/large/password-protected documents, and full Python/Bash parity
remain incomplete. Read-only, mount, quota, lifecycle and CLI evidence belong to
the other maintained cohorts. No new visible CLI behavior came from this slice.
