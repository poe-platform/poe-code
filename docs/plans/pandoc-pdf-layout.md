# PDF layout completion

Keep the supplied-font, horizontal LTR Latin/Greek/Cyrillic profile explicit;
unsupported bidi/combining/shaping and absent glyphs fail. No CSS/TeX equivalence.

1. Add original failing in-memory tests for metrics, wrapping, pagination rules,
   repeated headers/split rows, aspect fit, zero advance and hostile sfnt records.
2. Implement typed engine options and bounded deterministic placement in packages/pdf.
3. Add failing AST tests, then adapt lists, figures, notes and lossy math in pandoc.
4. Run maintained scoped tests/lint/build. Render owned multi-page samples and inspect
   every page; record evidence in docs/pandoc. Commit verified atomic changes on main.

Rules: paragraphs default to two orphan and two widow lines (relaxed only when a
page cannot fit both); keep-together rejects blocks taller than a page; headings
keep with following content; long words/URLs/code wrap at glyph boundaries or fail
under explicit error policy. Tables repeat declared leading header rows; body rows
split only under explicit split policy. Images contain within explicit boxes and
retain aspect ratio. Notes use readable numbered endnote projection, never claim
footnote placement. Oversized indivisible blocks fail; contain images can shrink.

QA: generate original samples with packaged supplied font, long URL/code, nested
lists, Unicode, table spanning pages, large image and notes. Independently render
PDF pages using an available renderer outside unit tests; inspect all pages for
clipping, missing content, margins and pagination. Record tooling and limitations.

Status: engine original tests and implementation verified (23 engine tests,
scoped lint/typechecks and maintained selected build closure). All five pages of
owned engine samples independently rendered with PDFKit and visually inspected;
evidence in docs/pandoc/layout-engine-evidence.md. AST/CLI implementation is being
verified separately for its own atomic commit. No push/release authorized.
