# TypeScript converter follow-up QA

Executed 2026-09-16 on main at 405766cba. Procedure:
[agent QA procedure](../../plans/pandoc-typescript-safe-bash-qa.md).
Root and safe-bash instructions read; no scoped instructions found under pandoc,
docs or scripts. Existing unrelated plan modifications/logs preserved.
This is documentation/evidence work; no source change or new TDD claim.

## Executed checks

- Maintained Pandoc unit route: 1,067 tests / 47 files passed (exit 0).
- Maintained package lint including source/test typechecks: passed (exit 0).
- Actual public screenshot route: help and combined workflows captured and
  inspected. First screenshot predev built 78 tasks uncached and bundled root;
  this is not a claim that the normal root build route was rerun.
- Public SDK plain conversion: Heading followed by newline, no diagnostics.
- Explicit public plugin with MemoryFileSystem: command `-o` succeeded and
  readFile verified `<h1 id="heading">Heading</h1>` followed by newline.
- Actual built CLI: help/version, both format lists and GFM extensions succeeded;
  invalid format/option/extension and missing formats exit 2; missing file exit 9
  (`E_IO: Capability failed`, coded but little detail); printf pipe succeeded;
  real-provider `-o` exit 3 with readable atomic-publication capability gate.
  Final failing cases have empty stdout. Individual results: cli-final.json.
- Public capability descriptors and hard ceilings: sdk.json; matrix/ceilings
  in usage/limitations checked against these. DOCX read/write unavailable, XLSX
  read unavailable/write forbidden, PPTX directions available.

The exploratory cli.json was collected during screenshot predev and encountered
missing safe-js build artifacts in conversion cases. It is superseded by
cli-final.json after the build completed; no engine capability conclusion comes
from it. An exploratory inspectFormats call used an incorrect object argument;
the API takes argument strings. SDK output verification initially attempted cat
in a bare Shell; cat is not automatically registered. Final verification uses
the public filesystem byte API. These are QA setup errors, not converter defects.

## Independent visual findings

HTML: original generated standalone HTML rendered in Chrome 152.0.7977.84 with
JavaScript disabled, background networking disabled and DNS blocked. html.png
inspected: heading, two-line code, nested bullets, merged heading, multilingual
line and 120×60 color image visible. Image preserves 2:1 ratio. Captured viewport
ends during row 55; this new screenshot does not certify the lower document.
Earlier wide/narrow full findings remain in qa-typescript/results.md.

PDF: fresh output generated through public readDocument/writeDocument from
qa-typescript/pdf-final-source.html and explicit original.jpg document resource.
Rich source was not silently substituted: this existing supported profile excludes
merged cells, unsupported scripts and fragment links. All five fresh pages
rendered in PyMuPDF 1.26.4 / MuPDF 1.26.7 and inspected (pdf-1..5.png).
No visible margin clipping; heading/code/bullets readable; café, Greek and Cyrillic
visible; image 2:1. Table headers repeat on pages 2..4. Row 12 splits between
pages 1/2, leaving an empty left cell beside its continuation on page 2. Rows
13..65 remain ordered. Second heading appears on page 5. Two external URI
annotations on page 1 and one on page 5 retained in pdf.json with rectangles;
none navigated. PDF hash recorded there. No Japanese/Arabic/shaping success or
merged-table PDF fidelity claim.

RST: Docutils 0.21.2 successfully parsed the existing simple generated output,
with raw/file insertion disabled, halt/report level 2; inert rendered rst.html
retained. This is a pinned syntax check, not a new RST visual inspection.

| Required lane | Follow-up status |
| --- | --- |
| EPUB independent reader/spine/TOC/links/media/reflow | Not rerun: no installed independent reader command; prior EPUB.js 0.3.93 reader execution and findings remain explicitly historical in qa-typescript/results.md. |
| RTF independent word processor | Not run successfully: TextEdit open attempted; AppleEvent timed out (-1712), desktop showed no document. Prior Quick Look is not a word-processor pass. |
| LaTeX external tooling | Not run: pdflatex, lualatex and tectonic absent; intended pin remains Tectonic 0.15.0. No TeX executed. |
| DOCX converter independent application | Not run: converter adapter unavailable; sibling byte/editing APIs do not satisfy that gate. |
| PPTX converter independent application | Not rerun successfully; existing LibreOffice startup stall and first-slide Quick Look evidence remain partial. Full deck inspection incomplete despite enabled converter. |
| Office editing | Not exercised; conversion creates documents and does not establish editing acceptance. |

No active document content, macros, TeX shell escape or remote links executed.
No new visual converter defect validated sufficiently for a code fix. PDF row
splitting remains a disclosed finding, not an unsupported full-fidelity claim.

## Documentation, cleanup and delivery

Procedure now records reproducible public commands and common setup pitfalls.
Usage/limitations and package README draft updated with verified resource and
publication workflows. Actual README files unchanged. Explicit README permission
gate and missing-README package-lint prerequisite remain incomplete.
Normal root build, repository-wide lint/test gates were not rerun for this docs
follow-up; earlier incomplete root test results are not converted into passes.

QA-only tools were pinned temporarily under this evidence lane because /out is
read-only on this host, then removed; no tooling added to product dependencies.
Only owned evidence/docs staged explicitly. Local documentation commit reported
in final response; no push, verified remote-main delivery or release.
