# Pandoc PDF adapter evidence

Original failing conversion tests preceded support for nested lists/figures/notes,
lossy math, SDK/CLI font/page options and early font-stream admission. Preserved
the thin safe-bash adapter; no native runtime or rendering fallback was added.

Maintained checks: `npm test --workspace=@poe-code/pandoc -- --reporter=dot`
(898 tests), `npm run lint --workspace=@poe-code/pandoc` (ESLint and production/test
typechecks), and `npm run build:workspaces -- --workspace=@poe-code/pandoc`.
CLI output and font file input are verified through memfs. Fonts/page geometry
are also verified through writeDocument; invalid options and excessive font
counts fail before lazy input acquisition. Font byte limits stop source consumption
before further chunks are retained. No unit host mutation/executable, network
fixture download or LLM was added. Repository-wide checks were not run.

PDFKit independently rendered all six pages of `layout-owned.pdf` outside unit
tests. All six PNGs were inspected. Page 1 has Greek/Cyrillic text, a long URL,
nested bullet/decimal lists and wrapped long code. Pages 2–4 have repeated declared
table headers and row 4 split across pages 2–3, preserving all lines 1–28. Page 5
keeps the heading with a large aspect-preserving square image and caption. Page 6
preserves a note reference, explicit readable math source, and both numbered notes.
No clipping, overlaps, missing content/glyphs or endless pagination was observed.
PDFKit-extracted text is retained separately as additional content evidence.
The initial inspection exposed an orphan heading; a failing original engine test
preceded that correction and every final page was re-rendered and inspected.

The JSON source records original content and original one-pixel PNG bytes. It was
generated with writeDocument, converting resource byte arrays to Uint8Array and passing
`{to: "pdf", lossy: true, pdfPage: {width: 300, height: 420, margin: 24}}`.
The packaged JetBrains Mono font is explicitly supplied by the adapter when no
font sources are supplied. No ambient font discovery occurs.

SDK options: `pdfPage` is `{width,height,margin}` in points; `pdfFonts` is an
ordered nonempty array of InputSource, replacing the packaged font and defining
fallback order. CLI equivalents: `--pdf-page WIDTH,HEIGHT,MARGIN` and repeatable
`--pdf-font PATH` through the injected VFS read capability. They apply only to PDF.
Font count/byte ceilings derive from the engine's exported default limits and
shared converter budgets. Engine layout options remain typed in packages/pdf.

Notes are readable numbered endnotes, not page-bottom footnotes. Math fails in
strict mode; `--lossy` explicitly projects `[math source: …]` with a diagnostic.
Lists support bullets and decimal ordered styles/delimiters. Figures preserve
content and captions. Tables preserve declared widths and leading repeated header
rows, with line-split body rows. Spans, non-left alignment, intermediate table
headers/row headers, nested tables, mixed inline images and styled font roles
outside this profile fail explicitly. Script/shaping limits are documented in
layout-engine-evidence.md; no CSS/TeX equivalence or general bidi is claimed.

README changes remain unauthorized; this record documents the new options without
changing READMEs. Local-only delivery; no push or release authorized.
