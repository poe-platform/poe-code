# TypeScript RTF output

`writeDocument(document, {to: "rtf"}, context)` and the existing thin
`createPandocCommand` adapter use the same TypeScript writer in packages/pandoc.
No executable or native conversion runtime is used by conversion or unit tests.
RTF is always a complete ASCII document; `standalone` is accepted but does not
change its envelope. There are no writer environment variables.

## Fonts, colors and styles

The font, RGB color, paragraph-style and list tables are deterministic. Font
references and colors are sorted by their literal ASCII spelling; list ids use
document traversal order. Normal and six heading styles have stable ids.

`metadata["rtf-fonts"]` is a `MetaList` of `MetaString` font reference names.
These are **names only**, not embedded bytes, availability probes or promises
that the receiving application has that font. An explicit `font-family` span
must refer to a declared name. References currently require printable ASCII
without RTF delimiters, semicolons or surrounding whitespace. The unnamed f0
entry leaves default font selection to the receiver. No host fonts are queried,
opened or embedded. Font resources and other unreferenced binary resources are
rejected. The resource bag supports image bytes only.

Run attributes: `font-family`, `color` (`#rrggbb`), `font-size` (positive half-point
increments in `pt`) and `dir` (`ltr`/`rtl`). Heading attributes additionally
support `text-align`. Identifiers, classes and other attributes are rejected.
Character groups restore inherited formatting; every paragraph emits pard/plain.
Signed UTF-16 `u` escapes have exactly one `?` fallback per unit under `uc1`,
including each half of a non-BMP character. Braces/backslashes are escaped,
tabs/newlines use terminated control words, and unsupported controls are rejected.
Document direction may be ltr or rtl; auto is rejected rather than guessed.

## Supported output profile

Paragraphs, plain blocks, six headings, code text, line blocks, quotes, empty
attribute Divs, inline emphasis/bold/underline/strike/super/sub/small caps,
quotes, styled spans, links and pictures are supported. Nested bullet and
ordered lists have modern list tables, real numbering placeholders and visible
listtext labels, with at most nine levels. Decimal, alphabetic and Roman
numbering and the three standard delimiter forms are supported; Example
numbering is rejected. List starts must be 1–32767 (Roman values at most 3999).
Continuation paragraphs keep indentation without introducing another label.

Tables support rectangular, unmerged cells with column widths, per-column or
cell alignment, multiple cell paragraphs, sections and captions. The fixed
available width is 8640 twips; rounded boundaries must advance strictly.
Cell/row terminators have ambient intbl scope even after paragraph groups close.
Nested/merged tables, row-header semantics and attributed table structures are
rejected. Unsupported AST constructs, raw RTF, embedded/active objects and
executable field input are rejected before atomic publication. Hyperlinks allow
relative references or http/https/mailto/tel and reject field delimiters,
quotes, controls and unsafe schemes. Link/image titles are not supported.

## Explicit picture resources and limits

An Image target must exactly identify an explicit `document.resources` entry or
be supplied by the configured `context.resources.resolve` capability. No URL
fetch, ambient filesystem lookup or implicit resource download occurs. Duplicate
resource ids and non-image/unreferenced binary data are rejected. Existing
explicit VFS media preparation/extraction can supply the SDK resource bag before
writing; the writer does not broaden filesystem authority.

PNG supports noninterlaced 8-bit gray, RGB, gray-alpha and RGBA. Chunk bounds,
CRC, header ordering, consecutive IDAT, end-of-file, compressed stream, scanline
length and filter bytes are checked. Only fixed-size gAMA/cHRM/sRGB/pHYs
ancillary chunks are permitted; palette/interlaced/other chunks are outside this
profile. Deflate validation uses a bounded stream with expected scanline
capacity reserved before reads; pixels are not converted or re-encoded.

JPEG supports 8-bit one- or three-component baseline/progressive frames, bounded
scan traversal, sampling factors up to 2, restart markers and JFIF application
metadata. Other application metadata/unsupported markers are rejected. The
TypeScript jpeg-js decoder validates entropy data under a conservatively reserved
memory ceiling. No external decoder executable is called.

Dimensions are 1–32767 pixels. At 96 dpi, picwgoal/pichgoal are checked integer
pixel dimensions times 15 twips. Resource/binary/image/part/compressed/expanded,
layout/work/retained/reference and output budgets apply as relevant. Pixel and
decoder expansion is reserved before decoding; exact two-character hex expansion
is bounded before emitting image data. Final ASCII length equals byte length.
Decoder validation can conservatively reject an image under a tight memory
budget even when its compressed bytes would fit.

## Research and verification (2026-09-16)

Behavioral research consulted upstream `test/writer.rtf`, `test/tables.rtf`,
`src/Text/Pandoc/Writers/RTF.hs`, and command regressions
`test/command/lists-inside-definition.md` and
`test/command/unicode-collation.md`. The upstream main-tree command inventory
had no RTF-named command regression. No upstream implementation, fixture or
expected result was copied into the original tests.

All 20 writer cases are independently authored. The first ten failed on missing
capability. Later failing cases exposed missing picture encoding, exact-byte
overestimation, modern list definitions, explicit heading properties, tab stops
and progressive scan traversal. Unit filesystem mutation uses memfs only;
picture bytes are authored in memory (stored-deflate PNG and explicit-Huffman
JPEG), with no LLM, downloaded fixture or external executable.

- `npm test --workspace=@poe-code/pandoc`: 26 files, 841 tests passed.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint and both typechecks passed.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: maintained selected
  build closure passed.
- `rtf-writer-command.png`: adhoc screenshot of the built thin command output.
- `rtf-writer-application.json`: independently authored QA AST and image bytes;
  byte arrays must be reconstructed as Uint8Array before SDK writing. This is
  document evidence, not Pandoc's serialized JSON interchange format.
- `rtf-writer-application.rtf`: generated directly from that AST by the writer.
- `rtf-writer-application.rtf.png`: independently opened/rendered by macOS Quick
  Look (`qlmanage -t`), visually inspected. It verifies Unicode, bidi, formatting
  reset, explicit red run, heading and hyperlink appearance and list labels.
  Quick Look omits PNG/JPEG pict data, draws table cells as separate paragraphs
  and has tight marker spacing; this is **not acceptance of picture/table
  interoperability**. Local reader round trips are not used as acceptance.

TextEdit launch/Apple events and Quick Look's interactive preview did not produce
a document window. LibreOffice 26.8.0 was installed for a separate independent
RTF-import/PDF-export lane. macOS spctl accepted its Developer ID, but both its
headless document import and version launch stalled before dyld startup completed.
No PDF or LibreOffice picture/table screenshot has been obtained. Full external
application acceptance remains **incomplete**; follow the QA procedure in
docs/plans/pandoc-rtf-writer.md when application launching is available.
