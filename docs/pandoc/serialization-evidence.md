# Bounded PDF serialization evidence

Final engine: original TypeScript converter, packages/pandoc AST adapter and
packages/pdf byte/layout engine; existing thin safe-bash adapter. No host I/O,
subprocess or native runtime fallback in serialization. Binary publication and
streaming writes/close are awaited.

## Independent QA

Executed docs/plans/pandoc-pdf-serialization-qa.md with pypdf **6.0.0** strict
parser and PyMuPDF **1.26.4**, bundled MuPDF **1.26.7**, renderer. Pillow **12.0.0**
created original 4×4 images. None are unit dependencies or downloaded fixtures.

Original source: serialization-input-ast.json, its four adjacent PNG/JPEG images,
and serialization-reader-inputs.json. Output: serialization-qa.pdf. Detailed
object/text/image/hash results: serialization-oracle-results.json. Both parsers
verified all ten available reader-to-PDF pairs: commonmark, csv, epub, gfm, html,
json, latex, rst, rtf, tsv. Unavailable plain/html5/office readers are not counted.
Transient pair PDFs were removed after inspection; their hashes remain recorded.

The four-page PDF contains 25 indirect objects, 300×400-point pages, embedded
supplied TrueType font bytes (hash independently compared to the packaged font),
/Identity-H encoding, CID glyph references and /ToUnicode mapping, Unicode
metadata including 東京, two page-resolving flat bookmarks, one exact URI link
with parentheses/backslash, a two-cell table, RGB PNG with gray alpha mask,
grayscale/RGB/Adobe CMYK JPEGs, and wrapped Latin/Greek/Cyrillic text.
MuPDF reported no repairs or warnings. Both engines extracted original text in
all ten pair cases; normal prose preserves spaces after text-run batching.

Viewed all four 2× rendered screenshots (serialization-page-1.png through
serialization-page-4.png). No clipping, overlap or margin overflow; table rules
and text align; paragraph/heading spacing is readable. The ordinary filename
paragraph for the RGB JPEG ends page 1 and its image starts page 2: those separate
blocks have no keep-with-next constraint, and caption attachment is not asserted.
Measured first pixels: PNG alpha over white (144,192,224), gray (128,128,128), RGB
JPEG (33,128,192), CMYK (247,149,81), consistent with the pictured transparency,
gray, blue and orange. Device CMYK conversion is renderer dependent; no calibrated
color-conformance claim. Independent engines need not produce identical bytes.
Native Pandoc was not used as this engine's oracle.

## Original tests and resource boundaries

Original failing tests preceded implementation. Exact expected minimal object
records independently verify identities, stream lengths, xref offsets and trailer.
Regressions cover dangling/sparse references, unsafe sizes, nonfinite numbers,
direct cycles, invalid budgets before resource admission, hostile font shaping,
unsupported outline programs, Unicode glyph aliases, malformed Unicode metadata,
PNG inflation beyond declared scanlines, CRC/filters/truncation and JPEG precision
and color transforms. Existing geometry tests independently read font metrics;
new mapping tests read original sfnt cmap records rather than derive expectations
from the PDF writer. Unit filesystem mutations use memfs; no unit host scratch,
LLM, downloaded fixture or subprocess.

Admitted glyph codes and metrics form compatible text runs directly; font shaping
tables are not invoked. Conflicting emitted Unicode scalars sharing one glyph
are rejected. Supported fonts: sfnt TrueType glyf only (CFF/WOFF unsupported).
PNG: static noninterlaced 8-bit gray/RGB/palette/gray-alpha/RGBA; fixed scanline
buffers and bounded inflation precede RGB/alpha emission. JPEG: 8-bit gray/RGB,
or Adobe CMYK transform zero. Output size and xref identities/counts are checked
before the output Uint8Array allocation; serialized primitive copy sizes checked.

Metadata has no implicit clock fields; repeat rendering is byte deterministic.
CLI -t pdf and --yes .pdf inference resolve to the same SDK options. Explicit
--pdf-engine commands are rejected before input acquisition. No runtime oracle.

## Guarantees and limits

Output is untagged PDF 1.7. Accessibility/tagging/reading-order guarantees and
PDF/A/PDF/UA conformance are explicitly absent in pdfCapabilities(). Inspected
mapping and extraction fixtures support the observations above; universal
searchability, correct extraction, shaping, color accuracy or accessibility are
not claimed. Outlines are flat and target top-level paragraph first placements.

## Maintained validation

- PDF package: 45 unit tests pass; lint/typechecks pass.
- Pandoc package: 912 unit tests pass; lint/typechecks pass.
- Selected @poe-code/pandoc workspace build closure: PDF, office-package, Pandoc
  all pass via npm run build:workspaces -- --workspace=@poe-code/pandoc.
- Repository-wide npm run lint passes (ESLint, root types/contracts, workflows).
- Repository-wide npm test observed an unrelated toolcraft-design demo failure:
  missing docs/plans/archive/cli-aliasing.md, scripts/scripts.test.ts:85. The file
  is absent and untracked in the current checkout. Overall unit gate is not green;
  do not interpret scoped passes as repository-wide success. The remaining run
  was stopped after this failure; repository-wide unit validation is incomplete.

Delivery: verified local atomic commits on main only. No push or release.
