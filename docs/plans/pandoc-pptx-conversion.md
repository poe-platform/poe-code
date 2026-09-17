# PPTX conversion adapter

Task remains open until presentation-application QA is verified.

Status: implementation and public API/conversion gates pass; interactive
presentation-application QA remains open. Registry bindings are enabled for the
bounded conversion profile. Native editing remains with `pptx`.

## Boundary and policies

- Conversion belongs to `packages/pandoc`; presentation packaging, relationships,
  native editing and media admission belong to the separate `pptx` engine.
- Use only exported byte/model APIs. No converter PresentationML or ZIP writer,
  implicit filesystem, native runtime or network fallback.
- Default slide heading level is 1. Explicit integer levels are supported;
  automatic inference is rejected as ambiguous. Deeper headings remain content.
  Preamble forms an untitled slide. Each horizontal rule starts a new slide;
  consecutive breaks and title-only slides are retained.
- Reader output uses slide Divs and presentation/shape structural order. This
  order is not a promise of visual reading order.
- Paragraphs and nested bullet/decimal lists retain their sequence. PNG/JPEG
  images retain bytes and aspect ratio; unsupported image formats fail.
  Tables support rectangular unmerged plaintext cells with at most one header
  row and default column widths/alignment; captions, footer rows, spans and
  intermediate/row headers fail rather than silently flattening semantics.
- Speaker notes use an explicit `notes` Div, separate from visible slide text.
  Inline footnotes are not silently moved to speaker notes.
- Reference bytes must be explicitly supplied through resource capability.
  Layout mapping resolves names uniquely, and missing/ambiguous layouts fail.
  Reference slide content is removed through the engine; masters/layouts remain.
- Overflow admission is geometric and conservative. No measured text fit is
  claimed. No automatic font shrinking, text truncation or slide rasterization.
- Animations, charts and embedded objects are rejected unless a documented,
  explicitly selected lossy projection reports each loss.

## Execution and verification

1. Write original failing conversion cases before each code improvement.
2. Verify engine public byte APIs and required structured read/write operations.
3. Implement adapters, then maintained pandoc unit/lint/build checks.
4. Expand original decks using the breadth of the pinned upstream
   [Writers.Powerpoint cases](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Writers/Powerpoint.hs).
   Include layout/reference, title-only, blank, paragraphs, nested lists, notes,
   links, tables, images, ratios, sizing, missing layouts and overflow.
5. Independently inspect slide order/text, relationship targets and media bytes;
   use an inspector that does not call the engine's ZIP/XML implementation.
6. Save authored QA decks/evidence under `docs/pandoc`; open them in a presentation
   application, check repair warnings, layouts, notes and media, and inspect
   screenshots. Record actual application/version/results. Never count a missing
   application or a planned check as a pass.
7. Bind registry capabilities only after dependency and conversion gates pass.
8. Commit verified atomic work and its plan update on main; no push authorized.

## Configuration and remaining QA

All settings are string metadata, shared by SDK and CLI `--metadata key=value`:
`pptx-slide-level` (1 through 6, default 1), `pptx-reference` (resource identifier),
`pptx-layout-title-body` (default `Title and Content`), `pptx-layout-title-only`
(default `Title Only`) and `pptx-layout-blank` (default `Blank`). No new environment
variables. Layout placeholders supply inherited/declared title and body geometry;
missing geometry uses the fixed converter geometry. Only single-column layouts
are supported. Non-reference output is 16:9; reference output keeps deck size.
Reading does not preserve source canvas metadata for a subsequent fresh write.

Paragraph admission uses an 800-character limit and fixed geometry slots; it
does not measure font shaping, wrapping or fitting. Every write reports
`W_LAYOUT_UNMEASURED`; strict warning mode can refuse output. PNG/JPEG sizing
accepts positive in/pt/cm/mm/px dimensions, preserves aspect ratio and rejects
explicit dimensions outside the available body. Notes allow plaintext paragraphs.

Independent original-deck XML/ZIP inspection and macOS Quick Look screenshots
passed. LibreOffice launch did not complete, so no repair-warning, interactive
notes or presentation-application signoff is claimed. To close QA, open the
authored decks in PowerPoint or LibreOffice, inspect each slide and notes, check
for repair dialogs, and record application/version and screenshots under
`docs/pandoc`. See `docs/pandoc/pptx-verification.md` for actual check results.

## Numbering revalidation, 2026-09-16

Original tests reproduced three numbering losses before the fix: adjacent
decimal list restarts merged, parenthesized writer markers became periods, and
Roman reader markers became decimal without a diagnostic. Preserve explicit
numbering restarts; the supported writer profile is decimal with period/default
delimiter. Other source numbering requires explicit lossy mode and reports
`W_PRESENTATION_LOSS`. Explicit numbering starts are compared within each nested
level; omitted starts continue the active sequence.

The public API gate remains available, and existing registry bindings remain
enabled after conversion checks pass. Maintained scope verification: Pandoc
workspace tests (47 files, 1,066 tests), lint/source and test typechecks, and the
selected Pandoc workspace build dependency closure passed. The final additional
independent XML assertion is verified by the focused conversion suite.

QA follow-up: inspect `docs/pandoc/pptx-qa-numbering.pptx` in PowerPoint or
LibreOffice. Independent XML inspection verifies `arabicPeriod` starts 3 and 1;
Quick Look displays both as 1. This is a renderer discrepancy, not a verified
application numbering pass. Check actual rendered starts and marker spacing,
repair warnings and notes before closing the task. A fresh LibreOffice open
request succeeded, but GUI inspection timed out; opening was not verified.
Evidence and the inspected preview are under `docs/pandoc`, described in
`pptx-numbering-verification.md`. No push or release is authorized.
