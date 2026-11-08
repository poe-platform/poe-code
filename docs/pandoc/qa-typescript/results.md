# Executed TypeScript converter QA

Executed 2026-09-16 on main; procedure:
[agent QA plan](../../plans/pandoc-typescript-safe-bash-qa.md).
Source/tool identities and artifact hashes: source-identities.json.
No README application, push, remote delivery or release is authorized/performed.

## Acceptance lanes

| Lane | Observed status |
| --- | --- |
| Text conversion | Public SDK/plugin and actual CLI verified for supported profiles. Bounded subsets only. |
| HTML visual | Chrome 152.0.7977.84, scripts/network disabled; wide/narrow screenshots inspected. |
| PDF conversion/visual | Supported profile generated and all five pages rendered with PyMuPDF 1.26.4/MuPDF 1.26.7; inspected. Rich profile rejected. |
| EPUB conversion/reader | EPUB.js 0.3.93 archived upstream application with JSZip 3.10.1 and Chrome; inspected wide/narrow and next-page views; actual internal-link clicks verified. |
| RTF conversion | Supported simple profile generated. Quick Look preview inspected. Independent word-processor QA **not run successfully**: LibreOffice startup stalled and owned probe was stopped. |
| LaTeX external check | **Not run**: pdflatex, lualatex, tectonic unavailable; intended pin Tectonic 0.15.0. Generated inert source retained; not compiled or executed. |
| RST external check | Docutils 0.21.2 parsed simple output without diagnostics; raw/file insertion disabled. Spanning tables reject even with lossy. |
| DOCX conversion/visual | **Not run**: built-in adapter unavailable. No sibling byte-API evidence is counted as converter support. |
| PPTX conversion | Supported two-slide profile generated; W_LAYOUT_UNMEASURED recorded. Merged cells and CodeBlock rejected. |
| PPTX independent application | macOS Quick Look first-slide preview inspected; LibreOffice independent open/repair-dialog QA **not run successfully**, startup stalled. Second-slide Office application inspection remains incomplete. |
| Office editing | **Not exercised**. Converter operations create outputs; sibling editing APIs and historical editing evidence are separate. |
| XLSX conversion | Explicit unavailable-reader and forbidden-writer gates; no successful conversion claimed. |

## Concrete visual findings

- HTML wide/narrow: both headings, literal two-line code, nested bullet list,
  merged table heading, 65 ordered rows and multilingual text are visible.
  Original JPEG is 120×60 with preserved 2:1 ratio. Native browser typography is
  plain; the standalone writer does not add a theme. No horizontal clipping in
  the inspected 420 px sample. No remote link was navigated.
- PDF: no observed clipping in five pages. Latin accented, Greek and Cyrillic
  text are visible. Japanese/Arabic/combining source rejected explicitly with
  E_CAPABILITY; unsupported shaping is not a Unicode success. Merged cells also
  reject. Supported profile removed the merged row and substituted external
  targets for unsupported fragment links, with explicit image dimensions in
  points. Image retains 2:1 ratio. Header repeats on continuation pages. Row 12
  splits across pages 1/2; page 2 starts with its remaining right-cell line and
  empty left cell. Rows 13..65 continue in order; page 5 contains the second
  heading and backlink label. This split is visible, not a full-fidelity claim.
  MuPDF reports two external URI annotations on page 1 and one on page 5;
  annotation rectangles/targets are retained in pdf-report.json. No links opened.
- EPUB: two spine chapters and two TOC entries have distinct chapter/anchor
  targets. Wide layout uses two columns; narrow layout wraps table cells and
  headers, preserves merged cells, code, list indentation and 2:1 media. Actual
  forward/backlink clicks reached chapter 2 and returned to chapter 1. The next
  narrow page continues rows 2..10. Nine narrow pages are reported for chapter 1.
  External target inspected without navigation; reader requests were intercepted
  with local original book and pinned reader libraries, all other network denied.
  Book content contains no scripts; reader tooling alone executes trusted code.
- PPTX Quick Look: first title, accented/Greek/Cyrillic/Japanese text and nested
  bullets visible; bullet glyphs sit close to labels. Text fit remains unmeasured
  by the converter. This is a first-slide preview, not PowerPoint fidelity or
  complete deck/notes/table/media inspection.
- RTF Quick Look: heading, multilingual line, code and bullets visible; table
  cells appear vertically as text in this preview. Because the required word
  processor could not start, this is an unresolved renderer finding, not a
  validated converter defect or successful word-processor acceptance.
- CLI help screenshot inspected: readable usage, options and current available
  format directions. Workflow screenshot inspected: format list, readable format
  and unsupported-option errors, successful pipe output, and honest -o gate.
  Long command header was suppressed for the workflow screenshot to keep output
  legible. These are ad hoc screenshots, not unit tests.

## SDK and CLI execution

`sdk-cli-final.json` records built public runBash conversion with explicit
`pandoc: {limits: {inputBytes: 1024}}`, equality with direct SDK plain conversion,
exit 127 without opt-in and budget rejection under inputBytes 1. Actual
`node dist/bin.cjs bash --pandoc --root docs/pandoc/qa-typescript -c …` cases cover
help, both capability lists, extensions, bad format, bad options/extensions,
missing required formats, missing file and a printf pipe. Failures have empty
stdout and readable coded stderr. `shell-cases.json` records successful command
-o publication through MemoryFileSystem; the actual CLI RealFileSystem rejects
-o with E_CAPABILITY before reading inputs because conditional atomic publication
is unavailable. No successful real-filesystem -o workflow is claimed.

Screenshots were captured through `npm run screenshot-poe-code --` with the actual
public `bash --pandoc` integration; no root pandoc subcommand was invented.

Initial manifest entries were collected before completion of the fresh build;
those are exploratory failures, not final current gate certifications. A public
import during concurrent builds failed on a missing build artifact. Successful
EPUB/RTF/RST/PPTX profiles and final PDF source were subsequently generated from
fresh public build output. All profile reductions and rejection messages are
retained in manifest.json and adjacent inert HTML sources. No new renderer defect
was validated sufficiently to justify changing conversion logic. The missing CLI
opt-in was reduced to three original failing CLI/SDK checks before implementation.

## Maintained verification

- Original CLI/SDK red: 3 failures, 21 passes (qa-cli-red.log).
- CLI/SDK green: 24 passes (qa-cli-green.log).
- Focused final public/CLI/SDK route: 28 passes in 3 files (qa-public-final.log).
- Pandoc workspace unit route: 1,043 passes in 46 files (qa-pandoc-unit.log).
- Pandoc workspace lint, including source/test TypeScript checks: passed.
- Normal uncached npm run build: initial run failed from an artifact race during
  overlapping builds; sequential final run passed (qa-build-final.log), including
  root suffix stages. Screenshot predev cache hits are not counted as this gate.
- Initial npm run lint: failed while transient external QA tooling was present;
  human diagnostics and summary retained in qa-lint-initial.txt, oversized raw
  guard receipt purged. Owned .tools/.venv/.lo-profile were removed afterward.
- Cleaned npm run lint rerun: passed (exit 0), zero errors / 14 warnings;
  root TypeScript/contract and workflow lint stages passed. Concise human output
  and receipt summary retained in qa-lint-final.log; oversized raw receipt purged.
- Full npm test: failed on missing docs/plans/archive/cli-aliasing.md and an
  unrelated safe-python exhaustive codec timeout. Owned failing runner stopped
  after approximately nine minutes; incomplete, not a pass (qa-test.log).
  No unrelated fixture/code was changed; no unavailable profile counted as pass.
- npm run lint:packages: failed, missing pandoc/PDF READMEs. Drafting is authorized;
  README application is not. This prerequisite remains incomplete.

## Delivery

CLI/SDK opt-in local commit: 85eb2cd48. The documentation/evidence commit is
recorded separately in the final response. No push or release.
Usage/limitations and comprehensive package README draft are reviewable outside
README files. Remaining independent word-processor/Office-open and TeX QA and full
repository test gate are explicitly incomplete; no full-Pandoc/full-fidelity claim.
