# Header-only table layout verification

Root AGENTS.md applies; no PDF/Pandoc scoped AGENTS.md exists. The existing engine
and AST adapter already implement the explicit supplied-font LTR profile described
in layout-engine-evidence.md and layout-adapter-evidence.md. No runtime fallback
or additional conversion logic was added outside these packages.

Original in-memory regression test failed: a five-line paragraph followed by two
declared header rows emitted one page, placing headers below the remaining page
space. The correction admits the entire header-only group before drawing it.

Maintained verification passed: `npm test --workspace=@poe-code/pdf` (48 tests),
`npm test --workspace=@poe-code/pandoc -- --reporter=dot` (1,063 tests),
`npm run lint --workspace=@poe-code/pdf` (ESLint and production/test typechecks),
`npm run build:workspaces -- --workspace=@poe-code/pandoc` (declared build closure).
No unit filesystem mutations, external programs, downloads or LLM calls added.

Owned sample header-only-layout.pdf uses explicit packaged JetBrains Mono,
160 x 120 point pages with 10-point margins, a paragraph containing a through e
on separate lines and a one-column table containing header one/header two.
Generated through built renderPdf outside unit tests. Swift PDFKit/AppKit rendered
both pages at 800 x 600 pixels. Visually inspected both accompanying PNGs: paragraph
complete on page 1, both bordered headers together on page 2; no clipping, overlaps,
missing glyphs or extra pages. PDFKit extracted exactly a/b/c/d/e and both headers.

Also visually inspected the existing five engine and six adapter sample PNGs,
covering empty/single/multiple pages, Greek/Cyrillic, split rows and repeated
headers, wrapped URLs/code, nested lists, large square image, source math and
numbered endnotes. No visible clipping or missing content observed. Those eleven
renders were existing evidence, not newly generated in this audit.

Limits remain explicit: no general bidi/contextual shaping, combining sequences,
CSS/TeX equivalence or page-bottom footnotes. Unsupported scripts/glyphs fail;
notes are endnotes and math requires strict failure or explicit lossy source.
Repository-wide checks not run for this focused PDF placement correction.
No push or release authorized.
