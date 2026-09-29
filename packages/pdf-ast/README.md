# @poe-code/pdf-ast

Unified first-party PDF AST, parser, lossless editor, extractor, and 2D PNG rasterizer for TypeScript.

`@poe-code/pdf-ast` provides a three-layer PDF Abstract Syntax Tree (`COS Object Graph` → `Content Stream & 2D Display List` → `Semantic & Layout Extraction AST`) so applications can parse, inspect, edit, redact, merge, extract tables/text, and render PDFs to PNG with zero native dependencies.

## Feature Index

| Capability | Entry Point | Description |
| --- | --- | --- |
| Create & Load PDFs | `PdfDocument.create()`, `PdfDocument.load(bytes)` | Parse PDF 1.0–2.0 documents (`xref` tables, XRef streams, `/ObjStm`, `/Prev` revisions, damaged `startxref` repair, recoverable truncated Flate streams) |
| Page Drawing Canvas | `page.drawText()`, `page.drawRect()`, `page.drawPath()`, `page.drawImage()` | Draw styled text, vector graphics, and embedded RGB/PNG images |
| Content-Stream Redaction | `page.redact(regions, options)` | Physically strip glyphs and vector paths intersecting redaction boxes and paint replacement labels |
| Text & Table Extraction | `doc.extractText()`, `doc.extractTables()`, `doc.toSemanticAst()` | Spatial reading-order clustering (`logical`, `layout`, `raw`, `bbox`), table recovery, and semantic AST conversion |
| Page Merging & Forms | `doc.copyPagesFrom()`, `doc.getFormFields()`, `doc.setFormField()` | Deep-clone pages across PDFs and inspect or fill `AcroForm` fields |
| Form Data & Flattening | `parseFormDataBytes()`, `flattenDocumentFormFields()` | Parse FDF, XFDF, and `dump_data_fields` stanzas; bake widget appearances as resource-isolated Forms without rewriting their bytes |
| Image Extraction | `extractDocumentImages(doc.cos, options)` | Extract XObject, nested Form XObject, and inline images with CTM PPI, `/SMask` alpha, `/ImageMask` stencils, and PDF.js JPEG/JBIG2/JPEG 2000 decoding |
| Security & Encryption | `doc.save({ encrypt })`, `PdfDocument.load(bytes, { password })` | Read Standard Security Handler `R2`–`R6`; write fresh AES-256 `R6` encryption or explicit RC4 `R3` |
| Raster & Vector Export | `renderPdfPageToBitmap()`, `encodePng()`, `encodeJpeg()`, `encodePpm()`, `encodePgm()`, `encodePbm()`, `renderDisplayListToSvg()` | Paint text, images, and paths in PDF content order with curved/even-odd path clips and glyph clipping for text modes 4–7; export PNG, JPEG, PPM/PGM/PBM, and SVG with a pure-TypeScript rasterizer |

## Quick Start

```typescript
import { PdfDocument, rgb } from "@poe-code/pdf-ast";

// 1. Create a document and draw content
const doc = PdfDocument.create();
doc.setTitle("Architecture Report");

const page = doc.addPage([612, 792]);
page.drawRect({ x: 48, y: 720, width: 516, height: 36, fill: rgb(0.1, 0.2, 0.45) });
page.drawText("SYSTEM ARCHITECTURE", { x: 64, y: 732, size: 18, font: "Helvetica-Bold", color: rgb(1, 1, 1) });
page.drawText("Secret Token: 12345-ABCD", { x: 64, y: 680, size: 12, font: "Helvetica" });

// 2. Redact sensitive regions directly from the content stream AST
page.redact([[60, 670, 320, 700]], { replacementText: "[REDACTED]" });

// 3. Extract text, semantic AST, or render to PNG
const text = doc.extractText({ mode: "logical" });
const pngBytes = page.renderToPng({ scale: 1.5 });
const pdfBytes = doc.save({ normalizeContent: true });
```

After `page.redact()`, saving rewrites the file and removes unreachable objects,
including obsolete content streams and discarded image/Form resources. This also
applies when `incremental: true` is requested, since previous revisions would
retain the removed content. Content still used on other pages remains intact;
redact each occurrence that needs removal.

`page.evaluateDisplayList().operations` exposes paints in content-stream order,
including nested Forms and patterns. Isolated transparency Forms and Forms with
group opacity, blending, or soft masks appear as `group` operations; `softMask` preserves
Alpha/Luminosity mask content, backdrop, and transfer values. Standard-font glyph outlines are attached
to `glyph.outline`, keeping letters separate from page drawing paths. The `glyphs`, `paths`, and
`images` arrays remain available for inspection and extraction.

Stencil images preserve the current shading or tiling pattern in bitmap and
SVG output. Their transformed alpha masks are available as `clipImages` on
display-list paints; source image extraction remains independent of painting.
ExtGState soft masks and Form group opacity apply to bitmap and SVG output;
SVG rasterizes soft masks at the export scale. Pages with a non-isolated masked
group containing blend or mask effects use a raster SVG fallback; other pages
keep Form contents as vectors.
Ordinary non-isolated Forms blend directly with page content. Forms with outer
opacity or blending use PDF.js's intermediate-surface behavior. Non-isolated
masked groups with inner compositing effects copy the page backdrop before
applying the outer mask, bounded by the transformed Form BBox. Full non-isolated
backdrop compositing for other combinations remains unsupported.
The viewer background stays outside page blend calculations in bitmap and SVG.

All 14 standard PDF fonts use bundled PDFium/Foxit outlines and PDF.js metrics.
PNG and SVG preserve font styles without installed system fonts; SVG exports
glyph paths with accessible labels. Embedded Type1C and CIDFontType0C fonts use
PDF.js CFF decoding, including their encoding, CID selection, and font matrices.
Embedded Type 1 (`/FontFile`) programs use PDF.js decryption and conversion,
including PFB/hex containers, Differences, and composed accents. Embedded
TrueType CID fonts select outlines through `/CIDToGIDMap`, independently of
the Unicode labels used for extraction. TrueType subsets may omit `cmap`;
simple fonts recover glyph selection from PDF encodings and `post` names.
Embedded Type0 Encoding CMaps resolve
source character codes to CIDs before width and TrueType/CFF glyph selection.
OpenType CFF tables use the same PDF.js outline renderer. `doc.embedFont()`
preserves full OpenType CFF programs with their matching PDF font metadata,
including widths for every embedded glyph.
Word spacing follows encoded one-byte spaces, including remapped characters.
ToUnicode maps decode mixed one- through four-byte character codes, including
ligatures and supplementary Unicode characters.
Bitmap, PNG, and SVG rendering honor page rotation; pixel crops use displayed
coordinates after rotation.
Pass `useCropBox: true` to render the visible page area in any bitmap, PNG, or
SVG entrypoint. CropBox coordinates are normalized and intersected with MediaBox;
an empty intersection falls back to MediaBox, which remains the default when
cropping is not requested. Display lists retain `cropBox` metadata without
changing content coordinates. `getDisplayListCropBox(list)` exposes the resolved
visible bounds for applications choosing their own output size.
Rendering also honors nonzero and negative MediaBox origins. Display-list
`origin` metadata positions the page without changing extracted or edited PDF
coordinates, including clipped artwork, shading, and soft masks.
Sampled PDF functions interpolate gradients, soft masks, and tint colors across
all input axes, including packed 1–32-bit samples and reversed encoding ranges.
Exponential and stitched functions preserve their input domains and output
ranges, with the same tint evaluation for paths and images.
Calculator functions use PDF.js's JavaScript evaluator for arithmetic, bitwise
operations, conditionals, and stack operations, without dynamic code execution.
CMYK paths, gradients, and images use PDF.js's color conversion, including
indexed palettes and spot colors with a CMYK alternate space.
Bitmap strokes preserve joins, miter limits, caps and dash continuity, and apply
opacity once across overlapping segments of the same stroke.
Zero-length dashes preserve round and square dots in bitmap and SVG output,
including patterns set through graphics-state dictionaries.
Bitmap and SVG strokes retain unequal scaling and shear. Evaluated paths keep
their segments in page coordinates; when `strokeMatrix` is present, stroke width
and dash values are in that matrix's user coordinates. Paths without it retain
the page-coordinate convention. Thin strokes retain at least one device pixel.
Glyph outlines render even when text has no usable Unicode mapping. Unicode fallback covers characters present
in the bundled standard, Symbol, and Dingbats fonts; embed a font for other scripts.
A damaged optional ToUnicode stream does not prevent rendering embedded glyphs;
text extraction may be unavailable for those glyphs.

JPEG decoding uses PDF.js for baseline/progressive, grayscale, RGB, CMYK, and
YCCK images, with PDF `/Decode` and `/ColorTransform` handling.
JBIG2 decoding supports shared `/JBIG2Globals` dictionaries, arithmetic coding,
and MMR regions. JPEG 2000 decoding handles JP2 containers, raw codestreams,
and multiple tiles; image dimensions come from the codestream. Decode failures
raise errors instead of producing placeholder pixels. Rendering and image extraction
share these decoders, including inline images; extraction retains original encoded
image bytes and JBIG2 globals for native-format export.

Circular indirect-reference chains raise a PDF parse error; long acyclic reference
chains resolve without recursive JavaScript calls.

Resource limits default to `Infinity`. Set `maxObjects`, `maxDecompressedBytes`,
`maxRecursionDepth`, or save-time `maxOutputBytes` to enforce explicit budgets.
`maxObjects` also bounds cross-reference entries before object loading (with one
additional slot for the reserved free object zero).
The depth limit covers indirect-reference chains and nested COS arrays/dictionaries,
including repaired files and compressed object streams.
`maxDecompressedBytes` bounds each decoded stream and image RGBA buffer, including
masks and codec header dimensions. It is a per-buffer limit, not a total document
memory limit; codec working memory can exceed the final pixel buffer size.
