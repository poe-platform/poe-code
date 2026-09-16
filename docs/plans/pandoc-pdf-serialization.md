# Bounded PDF serialization

Own serialization in packages/pdf using pinned pdf-lib 1.17.1 object primitives;
keep conversion in packages/pandoc and the existing safe-bash adapter thin.
Preserve unrelated changes; local atomic commits only.

1. Original failing object tests: exact minimal object graph, xref offsets, stream
   lengths, references, escaped strings, malformed graphs, pre-allocation budgets.
2. Checked serialization after resource admission; deterministic Unicode metadata,
   heading outlines, explicit untagged/non-conformance capability guarantees.
3. Independent text-to-glyph, image color space and multipage graph tests; all
   supported readers have representable PDF cases; awaited sink, --yes PDF suffix
   inference, explicit external engine rejection.
4. Maintained package tests/lint/build. Explicit QA (never unit tests): record
   installed parser/checker and renderer versions under docs/pandoc, generate an
   original multipage linked/outlined Unicode document with an image, inspect
   objects/fonts/pages/text/links and rendered screenshots. Native Pandoc is not
   an oracle for this serializer. Different engines need not match bytes.

Status: checked serialization implemented; original expected-object and malformed
graph tests pass (26 PDF tests). PDF package lint/typecheck and maintained
selected workspace build pass. Deterministic Unicode metadata, flat page-linked outlines and escaped URI
strings implemented; explicit untagged/non-conformance capabilities. All 32 PDF
tests, lint/typecheck and selected workspace build pass. Integration and QA pending.

Resource admission: original regression reproduced overlong PNG inflation and
ignored CRC; owned PNG decoder now validates chunk order/CRC, fixed scanline
length and filters before bounded RGB/alpha emission. Static noninterlaced 8-bit
PNG; JPEG 8-bit gray/RGB and Adobe CMYK transform zero; unsupported CFF
outline programs rejected before fontkit. Pako 3.0.1 pinned explicitly.
All 38 PDF tests, package lint/typecheck and selected workspace build pass.

Additional graph regression: nonfinite PDF numbers were serialized rather than
rejected. Serializer now rejects nonfinite numbers and direct cycles before output
copying. Original failing regression passes; PDF tests (45), lint/typecheck and
selected Pandoc workspace build closure pass.
