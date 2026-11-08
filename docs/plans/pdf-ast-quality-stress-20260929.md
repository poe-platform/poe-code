# PDF AST correctness and stress qualification

The objective is practical PDF completeness using established implementations as
references, fast regression tests, independent rendering comparisons, and verified
delivery. Passing a finite suite does not establish complete PDF compatibility.

The original ten-hour qualification began on 2026-09-29 at 02:42 UTC. The user
extended completeness work for eight more hours at 15:14:54 UTC, through at least
23:14:54 UTC. Continue from delivered fixes and preserve the full qualification
scope below.

## Required outcomes

- Redaction removes targeted content from saved objects and prior revisions while
  preserving unrelated content and shared resources.
- Bitmap and SVG output preserve painting order across text, images, paths,
  nested Forms, clipping and transparency.
- JPEG, JBIG2 and JPEG 2000 use real decoding with independent reference pixels.
- Validate parser/writer round trips, malformed inputs, xref/object streams,
  encryption, resource budgets, forms, fonts, text/table extraction and rendering
  against independently produced PDFs.
- Compare real pages with independent renderers and inspect PNG evidence.
  Record unsupported behavior honestly; unavailable cases are not passes.
- Keep tests fast, deterministic and in memory. Execute visual/stress QA using
  the procedure below, with temporary outputs in ignored out directories.
- Preserve portable TypeScript operation and public API compatibility where
  possible; document coordinate conventions and deliberate API changes.
- Deliver atomic fixes after appropriate checks, verify remote main, and monitor
  publication and public installation separately from local commits and pushes.

## Reference implementations

Mozilla PDF.js is the primary reference, pinned at
`91041fb94d6744bc2a5bccd9aad28d617faa8195`. Port upstream tests and unchanged
fixtures with their licenses and provenance. The independent render helper uses
PDF.js 6.3.289. Its font substitutions must not be mistaken for an exact-font
oracle: embed the same font program when testing outline geometry.

PDFium revision `a84323421e94f484faca52dd9d027934eba42ab8` supplies established
AGG cubic subdivision and stroke math. Native comparisons call the unchanged
upstream algorithms with documented minimal adapters; they are not claims of
running the entire native rendering engine.

Use pypdf for independent editing/parsing checks and Poppler for additional
rendering comparisons. qpdf resource fixtures come from revision
`4eba95899886e851cc41d76886483b347612f2a8`. Full source provenance and license
notices live in the PDF package, alongside the regression fixtures.

## Current verified baseline

Remote main `c60b538907f6aef87d2e0a6bc3512c8ed12bba0c` includes the following
qualification improvements:

- Saved-content redaction, inherited/shared resource preservation and repeated
  edit stream reuse.
- Ordered painting, real image codecs and shared image extraction, decompression
  budgets, staged image downsampling and gradient-painted stencil images.
- Lexer/operator/dictionary recovery, damaged xref recovery, truncated Flate
  recovery, encrypted revisions and standard-security authentication cases.
- Standard and embedded Type 1/CFF/TrueType/OpenType outlines, character maps,
  widths, encoded word spacing, glyph clipping and page rotation.
- Path clipping and curve subdivision, soft masks, isolated-group opacity,
  stroke joins/caps/miter limits, paint-time stroke transforms and dash spacing.

The baseline passes 704 PDF tests plus 120 PDF command-consumer cases, package
lint/typecheck and the selected workspace build. Six real-file render comparisons
preserve visible content. Nineteen stroke-transform comparisons include exact
bitmap/SVG matches for unequal-axis rectangles and dash placement; the identical
embedded-CFF stroke case has mean RGB errors 0.0891/255 and 0.0755/255.

Scoped release 36603762289 published and publicly verified version 0.1.763,
including soft masks and isolated groups. Stroke-outline release 36606178658 is
still running; transform release 36607994971 is queued. Recheck these authoritative
jobs before reporting newer publication.

## Next qualification work

1. Finish zero-length dashes in graphics-state dictionaries and SVG, including
   high-resolution endpoint rounding and square caps. Preserve whole-stroke
   opacity and fill/clip behavior.
2. Reproduce and validate non-isolated transparency groups with reference output.
3. Broaden real-document coverage and editing round trips. Revisit every surviving
   corpus failure on current main, separating malformed-input recovery choices,
   unsupported behavior and renderer/font differences.
4. Continue investigating newly validated failures through the requested duration;
   do not treat the current defect list as exhaustive.

## Manual QA procedure

1. Reproduce a defect on current code with a failing in-memory test or concrete
   independent evidence before changing implementation.
2. Inspect the corresponding established-library behavior and port suitable
   tests/fixtures. Record license, revision, adaptations and expected results.
3. Run the narrow maintained package tests, lint/typecheck and build. Run relevant
   command-consumer suites when the public rendering/editing behavior changes.
4. Render synthetic boundary cases and real documents before/after the change.
   Compare bitmap and SVG with independent reference images at matching dimensions.
   Inspect the images, and distinguish antialiasing from missing/wrong geometry.
5. Save/reopen edited PDFs; independently parse/extract them and compare reference
   renders. Include shared resources and repeated edits where relevant.
6. Run bounded differential/stress cases for numeric algorithms or malformed
   structures. Do not count an oracle crash or unavailable result as a pass.
7. Review the complete change, commit only edited files, fetch/rebase after builds
   finish, push to main and verify remote ancestry. Track release jobs through
   actual publication and successful public installation.

Use `npm test --workspace=@poe-code/pdf-ast`,
`npm run lint --workspace=@poe-code/pdf-ast`, and
`npm run build:workspaces -- --workspace=@poe-code/pdf-ast` for focused checks.
Consumer coverage includes pdftk, pdftoppm, qpdf and pdftotext workspaces; broaden
it when extraction or other command behavior changes.

On this host /out is read-only. Temporary logs, reference checkouts and images
remain in ignored `out/pdf-ast-quality-20260929/`. Keep private coordination
references out of repository documents and commit messages.

## Completion audit

Before completion, inspect current code, tests, actual renderings, saved PDFs,
remote-main delivery and public-release evidence for every required outcome.
Retain the original scope and requested end time. Missing, partial, indirect or
uncertain evidence means qualification remains active; neither elapsed time nor
a passing subset establishes complete support.
