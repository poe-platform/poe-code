# @poe-code/pdf-ast

Unified first-party PDF AST, parser, lossless editor, extractor, and 2D PNG rasterizer for TypeScript.

`@poe-code/pdf-ast` provides a three-layer PDF Abstract Syntax Tree (`COS Object Graph` → `Content Stream & 2D Display List` → `Semantic & Layout Extraction AST`) so applications can parse, inspect, edit, redact, merge, extract tables/text, and render PDFs to PNG with zero native dependencies.

## Feature Index

| Capability | Entry Point | Description |
| --- | --- | --- |
| Create & Load PDFs | `PdfDocument.create()`, `PdfDocument.load(bytes)` | Parse PDF 1.0–2.0 documents (`xref` tables, XRef streams, `/ObjStm`, `/Prev` revisions, damaged `startxref` repair) |
| Page Drawing Canvas | `page.drawText()`, `page.drawRect()`, `page.drawPath()`, `page.drawImage()` | Draw styled text, vector graphics, and embedded RGB/PNG images |
| Content-Stream Redaction | `page.redact(regions, options)` | Physically strip glyphs and vector paths intersecting redaction boxes and paint replacement labels |
| Text & Table Extraction | `doc.extractText()`, `doc.extractTables()`, `doc.toSemanticAst()` | Spatial reading-order clustering (`logical`, `layout`, `raw`, `bbox`), table recovery, and semantic AST conversion |
| Page Merging & Forms | `doc.copyPagesFrom()`, `doc.getFormFields()`, `doc.setFormField()` | Deep-clone pages across PDFs and inspect or fill `AcroForm` fields |
| Form Data & Flattening | `parseFormDataBytes()`, `flattenDocumentFormFields()` | Parse FDF, XFDF, and `dump_data_fields` stanzas; bake widget appearances as resource-isolated Forms without rewriting their bytes |
| Image Extraction | `extractDocumentImages(doc.cos, options)` | Extract XObject, nested Form XObject, and inline images with CTM PPI, `/SMask` alpha, `/ImageMask` stencils, and PDF.js JPEG/JBIG2/JPEG 2000 decoding |
| Security & Encryption | `doc.save({ encrypt })`, `PdfDocument.load(bytes, { password })` | Standard Security Handler (`R2`–`R6`, RC4, AES-128, AES-256) encryption and decryption |
| Raster & Vector Export | `renderPdfPageToBitmap()`, `encodePng()`, `encodeJpeg()`, `encodePpm()`, `encodePgm()`, `encodePbm()`, `renderDisplayListToSvg()` | Paint text, images, and paths in PDF content order; export PNG, JPEG, PPM/PGM/PBM, and SVG with a pure-TypeScript rasterizer |

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
including nested Forms and patterns. Standard-font glyph outlines are attached
to `glyph.outline`, keeping letters separate from page drawing paths. The `glyphs`, `paths`, and
`images` arrays remain available for inspection and extraction.

All 14 standard PDF fonts use bundled PDFium/Foxit outlines and PDF.js metrics.
PNG and SVG preserve font styles without installed system fonts; SVG exports
glyph paths with accessible labels. Unicode fallback covers characters present
in the bundled standard, Symbol, and Dingbats fonts; embed a font for other scripts.

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
The depth limit covers indirect-reference chains and nested COS arrays/dictionaries,
including repaired files and compressed object streams.
`maxDecompressedBytes` bounds each decoded stream and image RGBA buffer, including
masks and codec header dimensions. It is a per-buffer limit, not a total document
memory limit; codec working memory can exceed the final pixel buffer size.
