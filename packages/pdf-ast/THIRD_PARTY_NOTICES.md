# pdf-ast licensing

Original code is MIT-licensed; see `licenses/MIT.txt`. The bundled and adapted
components below retain their respective terms and notices.

# Mozilla PDF.js

The numeric recovery and malformed-command handling in `src/cos/lexer.ts`, and
the regression cases in `src/cos/pdfjs-lexer.test.ts`, are adapted from Mozilla
PDF.js (`src/core/parser.js` and `test/unit/parser_spec.js`), revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195`.

Copyright 2017 Mozilla Foundation. Licensed under the Apache License, Version 2.0;
the full license is in `licenses/PDFJS-APACHE-2.0.txt`.

Adaptations use the local byte-offset/token API, preserve explicit token budgets
and existing exponent support, and translate Jasmine assertions to Vitest. These
files have been modified from the upstream originals.

The content operator vocabulary, known-command token boundaries, and operand
recovery in `src/content/operators.ts`, `src/content/parser.ts`, and
`src/cos/lexer.ts` follow PDF.js `EvaluatorPreprocessor` and `Lexer`. The cases
in `src/content/pdfjs-operators.test.ts` are adapted from
`test/unit/evaluator_spec.js` at the same revision. Nested text assertions use
`BT`/`ET` to expose local text AST nodes; unmatched `Q` is omitted from the local
balanced group representation. Copyright 2017 Mozilla Foundation, Apache-2.0.

The binary-string conversions in `src/bytes.ts` and five utility test cases in
`src/bytes.test.ts` are adapted from `src/shared/util.js` and
`test/unit/util_spec.js` at the same revision (Copyright Mozilla Foundation,
Apache-2.0). Adaptations add TypeScript types, use spread with bounded 8192-byte
chunks, and replace the upstream error helper with Error. Additional tests cover
all byte values, content serialization, and form appearance resource isolation.

Source: https://github.com/mozilla/pdf.js

# qpdf

The fixtures documented in `src/fixtures/SOURCES.md` and the shared-page
selection regression in `src/edit/qpdf-resources.test.ts` come from qpdf revision
`4eba95899886e851cc41d76886483b347612f2a8`. Resource-use analysis also follows
qpdf's `ResourceFinder` and `QPDFPageObjectHelper` behavior.

Copyright (c) 2005-2021 Jay Berkenbilt, 2022-2026 Jay Berkenbilt and Manfred Holger.
Licensed under Apache-2.0; see `licenses/PDFJS-APACHE-2.0.txt`. The tests were
adapted to the local TypeScript API and extended with redaction cases.

Source: https://github.com/qpdf/qpdf


# PDF.js standalone image decoders

`src/vendor/pdfjs-image-decoders.mjs` vendors the official PDF.js 4.1.392
`image_decoders/pdf.image_decoders.mjs` distribution (Mozilla Foundation,
Apache-2.0). This is the last PDF.js release with synchronous JavaScript JPX
and JBIG2 decoders, matching this library's synchronous, portable API.
Local JPX bounds checks reject truncated boxes, markers, tile parts, zero tile
sizes, and zero component subsampling before allocation. A 101-byte JP2 prefix
otherwise exhausts memory in the upstream build. Other adaptations remove the global export
assignment and unavailable source-map reference, add per-instance dimension
callbacks to enforce requested image budgets before pixel/region allocation,
preserve budget errors through JPX recovery, add a generated-code lint
comment, and provide a local TypeScript declaration for the used API.

Source: https://unpkg.com/pdfjs-dist@4.1.392/image_decoders/pdf.image_decoders.mjs
Upstream SHA-256: `257b89097a3266bcae8cd04d6faaec135a0774f6762b4476c44f0c76f8334f49`.
Full license: `licenses/PDFJS-APACHE-2.0.txt`.
Fixture provenance and independent reference pixels are documented in
`src/fixtures/SOURCES.md`.

# PDF.js font parsing, metrics, and path compilation

`src/vendor/pdfjs-fonts.mjs` bundles PDF.js CFF parsing/compilation, Type 2 path
compilation, encodings, Adobe glyph names, and standard-font metrics from revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195` (Mozilla Foundation, Apache-2.0).
The only source adaptation exports the internal `Type2Compiled` class; local
code converts its path commands to PDF AST segments without evaluating generated
JavaScript. `src/fonts/pdfjs-cff.test.ts` ports eight cases from
`test/unit/cff_parser_spec.js` to Vitest, retaining the Adobe CFF specification
example bytes and the upstream expectations. The JavaScript bundle can be
regenerated with `scripts/vendor-pdfjs-fonts.mjs <PDF.js checkout>`.

# PDFium/Foxit standard fonts

`src/fonts/standard-font-data.ts` contains base64-encoded, unmodified CFF font
programs. Serif, fixed-width, Symbol, and Dingbats faces are the `Foxit*.pfb`
files from the same PDF.js revision's `external/standard_fonts` directory.
Despite their extension these are CFF programs, not Type 1 PFB containers.
Sans faces are the byte arrays in `FoxitSans{,Bold,Italic,BoldItalic}.cpp` from
PDFium revision `a84323421e94f484faca52dd9d027934eba42ab8`, directory
`core/fxge/fontdata/chromefontdata`.

Copyright 2014 The PDFium Authors. Original code copyright 2014 Foxit Software
Inc. Licensed under the BSD terms in `licenses/PDFIUM-BSD.txt`.
Sources: https://github.com/chromium/pdfium/tree/a84323421e94f484faca52dd9d027934eba42ab8/core/fxge/fontdata/chromefontdata
and https://github.com/mozilla/pdf.js/tree/91041fb94d6744bc2a5bccd9aad28d617faa8195/external/standard_fonts

Regenerate the portable font-data module using
`scripts/generate-standard-font-data.mjs <PDF.js checkout> <directory containing FoxitSans*.cpp>`.
No Liberation font files are included.

# PDF.js JPEG decoding

`src/extract/images.ts` uses the `JpegImage` export of the standalone decoder
bundle above, replacing the local handwritten JPEG codec. PDF `/Decode` and
`/ColorTransform` handling follows PDF.js v4.1.392 `src/core/jpeg_stream.js`.
The vendored decoder accepts an optional dimension callback before allocating
frame components, preserving caller-specified byte budgets.
`src/extract/jpeg-reference.test.ts` ports the CMYK image shape expectation from
`test/unit/api_spec.js` (issue 4888) and the baseline/extended/progressive SOF
header cases from `test/unit/jpeg_stream_spec.js` at revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195`. The SOF cases assert local byte-budget
behavior instead of browser ImageDecoder availability. Independent pixel
oracles extend those upstream checks; provenance is in `src/fixtures/SOURCES.md`.
Mozilla Foundation, Apache-2.0; see `licenses/PDFJS-APACHE-2.0.txt`.

# Embedded CFF integration

`src/fonts/cff.ts` reuses the same PDF.js CFF parser/compiler and Type 2 path
compiler for embedded Type1C and CIDFontType0C programs. Input bytes are copied
before PDF.js's in-place charstring repairs. Charset CIDs select glyphs directly;
PDF.js encoding tables and PDF Differences select simple-font glyphs. The shared
path adapter also renders standard fonts and supplies the Unicode mapping needed
by Type 2 seac compositions. `src/fonts/pdfjs-cff-mapping.test.ts` ports nine
charset/encoding/FDSelect cases from `test/unit/cff_parser_spec.js` at the pinned
revision, preserving input bytes and expected mappings. Mozilla Foundation,
Apache-2.0; see `licenses/PDFJS-APACHE-2.0.txt`.

# Embedded Type 1 integration

The font bundle also includes PDF.js `Type1Font` and `Type1Parser` at the pinned
revision. `src/fonts/type1.ts` uses their PFB/PFA handling, eexec/charstring
decryption, Type 1-to-Type 2 conversion, and original glyph mapping. It restores
the original charset after CFF conversion, preserves the embedded .notdef shape,
and follows `src/core/fonts.js` for seac base/accent selection and displacement.
`src/fonts/pdfjs-type1.test.ts` ports all 19 cases from
`test/unit/type1_parser_spec.js`, including CID binary/hex data, subroutines,
encryption, and malformed/truncated inputs. Adaptations add TypeScript types,
Vitest imports, and portable byte-to-hex conversion. Copyright 2017 Mozilla
Foundation, Apache-2.0; see `licenses/PDFJS-APACHE-2.0.txt`.

# ToUnicode CMap decoding

The same bundle includes the unmodified standalone `CMap` class and range budget
from PDF.js `src/core/cmap.js`; the regeneration script extracts that class without
its browser/network factory. `src/fonts/cmap.ts` adapts the upstream bfchar,
bfrange, cidchar, cidrange, and codespace block grammar to the existing synchronous
lexer and delegates range expansion and variable-length character decoding to
`CMap`. UTF-16BE conversion follows `PartialEvaluator.readToUnicode`, including
numeric entries and omitted leading zero bytes; local compatibility infers a fixed
source width when a codespace declaration is absent.
`src/fonts/cmap-codespaces.test.ts` ports eight cases from
`test/unit/cmap_spec.js` plus the issue 18099 odd-length destination behavior from
`src/core/evaluator.js`, and adds integration cases. The tests adapt raw CMap
values to the public Unicode API. Copyright Mozilla Foundation, Apache-2.0, pinned
revision `91041fb94d6744bc2a5bccd9aad28d617faa8195`.


# TrueType CID-to-glyph selection

`src/content/evaluator.ts` follows PDF.js
`PartialEvaluator.readCidToGidMap` (`src/core/evaluator.js`, pinned revision
above) when reading big-endian glyph IDs, including zero-padding an odd trailing
high byte. The local dense map preserves explicit zero entries and selects glyph
zero for CIDs outside a supplied stream; Identity and omitted maps retain direct
CID-to-GID selection. Unicode extraction mappings do not choose CID font shapes.

Missing `cmap` tables are accepted following PDF.js `readCmapTable`.
`src/fonts/truetype.ts` adapts `readPostScriptTable` for version 1/2 glyph names,
using the upstream `MacStandardGlyphOrdering` table from `fonts_utils.js`.
Simple fonts without `cmap` use PDF.js-style BaseEncoding/Differences lookup
against those names. Synthetic tests verify CID and simple-font shapes separately
from their ToUnicode labels. The same pinned revision and Apache-2.0 license apply.


The CMap block parser and code reader are shared by ToUnicode and embedded Type0
Encoding streams. Following PDF.js font mapping, source character codes select
Unicode labels, while the Encoding CMap's CIDs select widths and embedded glyphs.
The synchronous integration adds no browser or external CMap-fetch dependency.


Word-spacing classification follows PDF.js `Font.charsToGlyphs`
(`src/core/fonts.js`) and canvas text painting: only an original one-byte 0x20
receives Tw, regardless of its Unicode label. The internal CMap reader preserves
that classification without changing the public ToUnicode result shape.

Simple-font character segmentation also follows `Font.charsToGlyphs`: Type1,
TrueType, and Type3 strings use single-byte codes even when ToUnicode declares
a wider codespace. `src/fonts/simple-font-codespace.test.ts` checks that behavior
and the original upstream issue17069 equality fixture, including TJ fragments,
word spacing, Unicode labels spanning multiple characters, and save/reopen.

Ordinary clipping follows PDF.js `CanvasGraphics.consumePath`: install pending
`W`/`W*` intersections after painting the current path, retaining nonzero/even-odd
winding and implicit closure. `src/render/path-clipping.test.ts` ports the normal
rendering assertions from `test/unit/api_spec.js`'s `should render with
operationsFilter` case (7200 black and 12800 white pixels) and the unchanged
`clippath.pdf` fixture. Other local cases cover curves, reversed rectangles,
transforms, save/restore, text/image intersections, and issue17069's signature.

# PDFium / Anti-Grain Geometry curve subdivision

`src/render/cubic.ts` adapts `curve4_div` from PDFium revision
`a84323421e94f484faca52dd9d027934eba42ab8`, file
`third_party/agg23/agg_curves.cpp` (Anti-Grain Geometry 2.3).
Copyright (C) 2002–2005 Maxim Shemanarev. Permission terms are retained in the
source and `licenses/AGG-2.3.txt`.

The TypeScript adapter uses double-precision numbers and arrays, merges the
equivalent one/two-control-point distance cases, and keeps the upstream
half-pixel flatness, collinearity handling, and recursion limit of 16.
`src/render/cubic-flattening.test.ts` compares against points generated by
compiling the unchanged upstream C++ algorithm with a minimal vector-storage
adapter; other cases use independently rendered PDF.js pixels.

Source: https://github.com/chromium/pdfium/blob/a84323421e94f484faca52dd9d027934eba42ab8/third_party/agg23/agg_curves.cpp

`src/render/stroke.ts` adapts the cap, join, miter and arc calculations from
`third_party/agg23/agg_math_stroke.h`, with forward/backward contour assembly
from `agg_vcgen_stroke.cpp`, at the same PDFium revision and under the same AGG
permission terms. The adapter uses double-precision arrays, PDFium's
`miter_join_revert` bevel fallback, and a one-million-vertex expansion limit.
Local dash splitting preserves joins across vertices and closed seams, resets
phase per subpath, and handles odd arrays and zero-length round dots.
Square zero-length dashes follow PDF.js/Canvas user-axis squares. Dash stepping
ignores a few ULPs of transformed endpoint residue; SVG reuses these contours for
zero-length patterns so its endpoint behavior and opacity match PDF painting.
`src/render/stroke-joins.test.ts` checks native cap/join vectors plus independent
PDF.js pixels; Poppler also confirms the final zero-length dash is omitted.
The native harness calls unchanged upstream math routines with minimal support
headers and local contour assembly; it is not the full upstream generator.

Source: https://github.com/chromium/pdfium/blob/a84323421e94f484faca52dd9d027934eba42ab8/third_party/agg23/agg_math_stroke.h

Stroke preparation in `src/render/raster.ts` adapts PDF.js
`CanvasGraphics.getScaleForStroking` and `rescaleAndStroke` from
`src/display/canvas.js` at revision `91041fb94d6744bc2a5bccd9aad28d617faa8195`
(Mozilla Foundation, Apache-2.0). It preserves paint-time user coordinates for
width/dashes, applies the per-axis minimum device thickness, and uses PDF.js's
larger-factor dash correction when the minimum rescales the axes differently.
The TypeScript adaptation uses arrays rather than Canvas/DOMMatrix objects,
shares preparation between bitmap and SVG, and suppresses singular strokes.
Tests compare independent PDF.js pixels, including identical embedded CFF text.


# SVG labels

SVG accessible labels use PDF.js `encodeToXmlString` from `core_utils.js`, with
a local XML 1.0 Char filter before encoding. Invalid controls and lone surrogates
cannot be made legal by numeric references. `src/render/svg-labels.test.ts` ports
the upstream valid-string cases from `core_utils_spec.js` and verifies complete
SVG documents with an independent XML parser. Only labels are sanitized; PDF
extraction and glyph geometry are preserved.

# Page rotation

The same font/graphics vendor bundle includes the unmodified PDF.js
`src/display/page_viewport.js` class. SVG rendering uses its rotation transform;
bitmap rendering rotates the finished page before applying pixel crops.
`src/render/page-rotation.test.ts` adapts the rotated viewport-size case from
PDF.js `test/unit/api_spec.js` to integer raster dimensions and adds public API
and pixel-geometry regressions. Mozilla Foundation, Apache-2.0, same pinned
revision as above.

# OpenType CFF tables

`src/fonts/truetype.ts` follows PDF.js `FontRendererFactory` by using the `CFF `
table when an sfnt font has no `glyf` table. It reuses the existing CFF parser
and path adapter, while retaining sfnt glyph mappings and metrics. The synthetic
OpenType fixture in `src/fonts/opentype-cff.test.ts` wraps the Adobe/PDF.js CFF
specification example from `cff_parser_spec.js`, with its second charstring
replaced by an unhinted triangle and compiled once with PDF.js CFFCompiler.
The test contains no system font assets. Mozilla Foundation, Apache-2.0, same
pinned revision and license as the other CFF cases.

# FlateDecode

The existing PDF.js vendor bundle also includes unmodified `FlateStream` and
`DecodeStream` from the pinned revision. `src/cos/filters.ts` subclasses its
output-buffer allocator to enforce caller byte budgets before growth and caps
buffer capacity at that budget. Raw-DEFLATE and gzip compatibility retains pako
with bounded output chunks. The simple predictor test in
`src/cos/pdfjs-flate.test.ts` is ported from `test/unit/stream_spec.js` to Vitest;
additional regressions use the extracted upstream streams listed in
`src/fixtures/SOURCES.md`. Copyright 2012/2017 Mozilla Foundation and
1996–2003 Glyph & Cog, LLC, Apache-2.0. The upstream Flate implementation is a
JavaScript port of XPDF's implementation.

`src/cos/pypdf-flate-recovery.test.ts` adapts the printable-byte example from
pypdf 6.19.0 `tests/test_filters.py::test_decompress`, with truncation results
checked against `pypdf.filters.decompress`. The bounded pako fallback in
`src/cos/filters.ts` retains partial zlib/gzip output on incomplete input,
following pypdf's recovery behavior without its byte-at-a-time decoding loop.
The original PDF.js issue11549 fixture additionally checks the recovered
Unicode map against pypdf's decoded bytes. pypdf attribution/license is below.

# PDF standard security handler

`src/vendor/pdfjs-fonts.mjs` also includes `src/core/crypto.js`,
`src/core/sasl_prep.js`, and their dependencies from the pinned PDF.js revision
`91041fb94d6744bc2a5bccd9aad28d617faa8195` (Mozilla Foundation, Apache-2.0).
The vendor script replaces `Map.getOrInsertComputed` with ordinary Map operations
and `Math.sumPrecise` with exact integer addition over sixteen bytes for Node 22
and ES2022 compatibility; it does not modify globals. The R5/R6 password hash
adapter in `src/cos/security.ts` uses PDF.js's PDF17/PDF20 implementation.
The AES256 length cases in `src/cos/security-writer.test.ts` are adapted from
PDF.js `test/unit/crypto_spec.js`, with independent Node AES validation.

The R3 and R6 encryption dictionary construction in `src/cos/security.ts`
follows pypdf 6.19.0 `pypdf/_encryption.py` (`AlgV4`, `AlgV5`, and
`Encryption.write_entry`). Modifications adapt the algorithms to the COS API,
use Web Crypto randomness, and use PDF.js for password hashing/preparation.
Fixed password/key/permission test values were generated independently with
that pypdf version and deterministic test-only entropy.

pypdf is BSD-3-Clause; copyright Mathieu Fenniak (2006–2008), Ashish Kulkarni
(2007), and Steve Witham (2014). See `licenses/PYPDF-BSD.txt`.
Source: https://github.com/py-pdf/pypdf/tree/6.19.0

The reader in `src/cos/security.ts` delegates authentication and cipher selection
to PDF.js `CipherTransformFactory`; its COS adapter resolves encryption entries
and preserves plaintext cross-reference streams, metadata, and signature
Contents. Explicit Crypt filter ordering follows PDF.js `src/core/parser.js`
`makeStream`/`filter`; the adapter retains the remaining encoded filter chain
when serializing decrypted documents. `src/cos/pdfjs-security.test.ts` ports 23
upstream authentication cases and adds integration regressions. The original
fixtures and their hashes are listed in `src/fixtures/SOURCES.md`.

For R5 passwords, the adapter additionally follows pypdf’s SASLprep policy as
a fallback after PDF.js rejects the raw UTF-8 candidate. The generated pypdf
regression fixture is documented in `src/fixtures/SOURCES.md`.

The recovery scanner in `src/cos/parser.ts` follows PDF.js `src/core/xref.js`
`XRef.indexObjects`: discover trailer and XRef dictionaries before object-stream
decoding, prefer encryption/ID-bearing trailers, and check Root/Pages candidates.
It retains the latest valid object bodies and checks the newest trailers first.
`src/cos/repair-encryption.test.ts` covers the original issue15893 fixture and
local integration cases, including encrypted object streams and direct Encrypt
dictionaries. Source revision and Apache-2.0 license are the same as above.

XRef stream validation in `src/cos/parser.ts` follows PDF.js `readXRefStream`
field-width, range, truncation, and entry-type checks. The zero-width regression
fixture in `src/cos/xref-validation.test.ts` is ported unchanged from
`test/unit/document_spec.js` at the same pinned revision. The adapter additionally
checks safe integers and caller-specified object budgets before xref map growth.

Uncompressed object loading also follows PDF.js `fetchUncompressed` by checking
object number and generation against the xref entry. Recovery retries the file
scan when an eager object read fails, preserving the common authentication and
resource-limit path. The original issue9418 fixture is documented above.

The original PDF.js issue2948 fixture covers mesh shading through PatternType 2
fills. Its provenance is recorded in `src/fixtures/SOURCES.md`; local triangle
cases exercise direct and chained references to the shading stream.

`src/edit/copy-pages.test.ts` ports `test_append_multiple` from pypdf 6.19.0
`tests/test_writer.py`, replacing its downloaded PDF with an in-memory page
and checking every copy and save/reopen. Page copying follows `_writer.py`
`_add_page`: each occurrence gets a distinct page dictionary while resources
can remain shared. Edits to shared content replace the page's Contents reference so
other pages retain their original stream. pypdf attribution/license is above.

Windows Symbol cmap selection in `src/content/evaluator.ts` follows PDF.js
`src/core/fonts.js` `checkAndRepair`: use encoded character codes for (3,0)
tables and clear the high byte only for F000–F0FF. The TrueType reader records
the selected cmap's encoding. Tests in `src/fonts/cid-to-gid.test.ts` cover
raw and prefixed symbol codes plus the original issue2948 fixture at the
same pinned PDF.js revision documented above.

Pattern-painted stencils follow PDF.js `CanvasGraphics._createMaskCanvas`:
the current pattern is painted in page coordinates through transformed mask
alpha, rather than coloring the source mask pixels. `stencil-pattern.test.ts`
ports the original `issue13372` equality fixture and adds memory-only coverage
for inline masks, rotation, inverted Decode, alpha, one-pixel masks, and tiling.
The source fixture and hashes are recorded in `src/fixtures/SOURCES.md`.
The one-pixel gradient expectation is independently verified by Poppler and
MuPDF; PDF.js's `paintSolidColorImageMask` optimization loses that pattern.

`src/render/image-sampling.ts` adapts `CanvasGraphics._scaleImage` from the same
pinned PDF.js revision (Copyright 2012 Mozilla Foundation, Apache-2.0). The
successive half-size canvas draws use local bilinear sampling with premultiplied
alpha; only the current reduction level is retained. Source-axis footprints
come from the inverse image transform to preserve rotated anisotropic reductions.
Final downscaling uses smoothing, as in `getImageSmoothingEnabled`, with one
device pixel as the enlargement threshold. `image-downsampling.test.ts` adds
memory-only stripe, alpha, transform, stencil, and save/reopen regressions;
the unchanged upstream issue13372 fixture also covers reduced patterned masks.

ExtGState soft-mask evaluation and rendering follow PDF.js `handleSMask`,
`beginGroup`, `_prepareSMaskCanvas`, and `_bakeSMaskCanvas` at the same revision
(Mozilla Foundation, Apache-2.0). The adapter captures page-coordinate mask
paints, resets group alpha/blend/soft-mask state, converts the luminosity
backdrop before filtering, and builds a 256-entry transfer table. Isolated
Forms retain their own paint groups so outer opacity is applied once.
Bitmap masks retain only the current prepared surface; SVG masks use the
export resolution while isolated Form contents remain vector groups.
`soft-mask.test.ts` ports four unchanged upstream equality fixtures, recorded
in `src/fixtures/SOURCES.md`, and adds local alpha/transform/group tests plus
the original issue17069 signature regression. Soft-mask evaluation is bounded
by the existing eight-level Form limit; mask-only text is excluded from extraction.

Non-isolated transparency Forms follow `beginGroup`'s direct-paint eligibility
and intermediate-surface state reset. Bitmap and SVG exports follow
`beginDrawing` in keeping the viewer background outside page blend calculations.
`src/render/transparency-group.test.ts` adds local opacity/blend/mask cases and
ports the unchanged `transparency_group.pdf` and `bug1873345.pdf` equality
fixtures, with independently obtained reference pixels. Full non-isolated
backdrop compositing for groups with outer effects retains PDF.js's documented
limitation.

Masked non-isolated Forms with inner blending or soft-mask effects follow
PDF.js `beginGroup`'s `needsBackdropCopy && inSMaskMode` path. The raster adapter
copies the existing page within the transformed Form BBox before painting the
group; ordinary outer-opacity groups keep their transparent intermediate.
`src/render/masked-group-backdrop.test.ts` covers this distinction and the
unchanged `issue13520.pdf` fixture. SVG uses a raster fallback for pages requiring
this backdrop copy; other Form groups retain their vector output.

CropBox handling follows PDF.js `Page.getBoundingBox` and `Page.view` in
`src/core/document.js`, and the SVG corner transform follows
`PageViewport.convertToViewportRectangle`. The adaptation stores bounds on the
local display list and crops before page rotation, keeping editing coordinates
unchanged. `src/render/crop-box.test.ts` covers these rules and the unmodified
`issue13520.pdf` equality fixture, recorded in `src/fixtures/SOURCES.md`.

MediaBox-origin rendering follows PDF.js `PageViewport` in
`src/display/page_viewport.js`: viewport coordinates subtract the normalized
lower-left page origin before applying rotation. Local rasterization applies
that translation to paths, strokes, images, clips, and intermediate mask/group
surfaces; SVG uses the vendored viewport transform. The unchanged PDF.js
`bug852992_reduced.pdf` soft-mask fixture and memory-only offset-page tests cover
this behavior in `src/render/media-box-origin.test.ts`.

Sampled-function interpolation adapts PDF.js `PDFFunction.constructSampled`
in `src/core/function.js`. The local evaluator reads the weighted neighboring
samples directly, supports unsigned packed samples through 32 bits, and handles
singleton axes without reading outside the table. Its degenerate-Domain test
is ported from `test/unit/colorspace_spec.js` (AlternateCS), with assertions on
the tint components before color conversion. The unchanged
`bug852992_reduced.pdf` fixture also verifies the restored soft-mask fade.

Exponential and stitched function evaluation follows PDF.js
`PDFFunction.constructInterpolated` and `constructStitched` in the same source:
apply the exponent to the input, and pass the stitched Encode result to the
child without rescaling it to a unit interval. Local memory-only regressions
cover non-unit domains, zero/negative exponents, output ranges, segment bounds,
reversed encoding, and image tint consistency. Domain and Range clipping also
follow the PDF function contract.

Calculator functions use the unmodified PDF.js `buildPostScriptJsFunction`
from `src/core/postscript/js_evaluator.js`, together with its AST and lexer.
The JavaScript evaluator interprets instructions without `eval`, `Function`,
or WebAssembly compilation. Compiled functions are cached weakly by COS stream;
code, Domain, or Range edits invalidate the entry. `pdfjs-postscript.test.ts`
ports 35 complete input/output vectors from `test/unit/postscript_spec.js`,
alongside comment, image-function integration, and edit-invalidation coverage.

The vendor bundle includes unmodified PDF.js `DeviceCmykCS` from
`src/core/colorspace.js`. Path, shading, and image color conversion use this
class directly, including CMYK palette entries and alternate tint colors.
`src/render/cmyk-colors.test.ts` ports the byte and floating-point reference
vectors from PDF.js `test/unit/colorspace_spec.js`, through local PDF APIs.

The same bundle exports unmodified `CalGrayCS`, `CalRGBCS`, and `LabCS`.
The shared calibrated-color adapter resolves COS parameters before calling
these classes. Paths, gradients, images, palettes, and calibrated alternate
tint spaces use the same converters. `calibrated-colors.test.ts` ports the
corresponding PDF.js `colorspace_spec.js` input/output vectors through those
APIs and the unchanged `calgray.pdf` equality fixture. Missing WhitePoint
retains the local D65 fallback for malformed input.

Malformed dictionary-key recovery follows PDF.js `Parser.getObj`, skipping
stray non-Name tokens only in local repair mode. Damaged optional ToUnicode
streams follow `PartialEvaluator.readToUnicode` error recovery while retaining
local resource-limit errors. `dictionary-recovery.test.ts` ports the original
`issue11549` equality fixture and covers ordinary/compressed dictionaries,
trailer metadata, strict mode, and explicit limits.

Mesh stream decoding, Coons/tensor patch tessellation, and vertex packing use
PDF.js `MeshStreamReader`, `MeshShading`, and their helpers from
`src/core/pattern.js` at the same revision (Mozilla Foundation, Apache-2.0).
The generator replaces only the constructor's PDF.js resource lookup with a
local stream/color adapter and uses equivalent ES2022 cache operations.
The decoding and geometry algorithms are unchanged. The local rasterizer
paints the resulting RGB triangles. `src/render/mesh-shading.test.ts` ports
the unchanged upstream equality fixtures `issue4227` and `issue6305-part-1`,
with independently rendered reference pixels recorded in the tests.

Function-shading BBox coordinates follow PDF.js `FunctionBasedShading` in
`src/core/pattern.js`, keeping the BBox separate from the function-domain
Matrix. The local evaluator transforms page pixels back into shading space
for clipping. `src/render/shading-bbox.test.ts` covers translated, rotated,
and sheared page transforms and the unchanged upstream equality fixture.
