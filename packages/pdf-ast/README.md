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
| Form Data & Flattening | `parseFormDataBytes()`, `flattenDocumentFormFields()` | Parse FDF, XFDF, and `dump_data_fields` stanzas; bake widget appearances into static page content |
| Image Extraction | `extractDocumentImages(doc.cos, options)` | Extract XObject, nested Form XObject, and inline images with CTM PPI, `/SMask` alpha, and `/ImageMask` stencil support |
| Security & Encryption | `doc.save({ encrypt })`, `PdfDocument.load(bytes, { password })` | Standard Security Handler (`R2`–`R6`, RC4, AES-128, AES-256) encryption and decryption |
| Raster & Vector Export | `renderPdfPageToBitmap()`, `encodePng()`, `encodeJpeg()`, `encodePpm()`, `encodePgm()`, `encodePbm()`, `renderDisplayListToSvg()` | Pure-TypeScript 4x4 subpixel anti-aliased scanline rasterizer to PNG, JPEG, PPM/PGM/PBM, and SVG |

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
