---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# Unified PDF AST, Engine, and Tooling Foundations

Create a dedicated, first-party PDF AST & engine package (`@poe-code/pdf-ast` in `packages/pdf-ast`, retaining only `pako` for deflate/inflate) built on a three-layer PDF AST for parsing, lossless editing, content-stream manipulation, layout, text/table extraction, and page-to-PNG rasterization.

## 1. What we're building

A standalone, first-party TypeScript PDF foundation (`packages/pdf-ast`, exposed as `@poe-code/pdf-ast`) that acts as the unified backbone for PDF producers, editors, inspectors, and extractors in the repository (`pandoc`, `ssconvert`, `wkhtmltopdf`, `soffice`, `qpdf`, `pdfinfo`, `pdftotext`, and `exiftool`), keeping `packages/pdf` untouched during parallel work.

Instead of splitting write-only wrappers and read-only parsers across separate utilities, `@poe-code/pdf-ast` owns a complete **three-layer PDF AST** and **ergonomic document/page/form/extraction SDK**:

1. **Layer 1 — COS & Revision Object Graph AST (`PdfCosDocument`)**:
   - Exact byte-preserving syntax tree for PDF 1.0–2.0 objects (`null`, `boolean`, `number` with raw token fidelity, `name` with hex-escape provenance, `literal`/`hex` byte strings, `array`, `dict` with ordered/duplicate-key retention, `stream` with filter pipelines, indirect `obj`/`ref`, classic `xref` tables, cross-reference streams, `/ObjStm` object streams, trailers, and incremental `/Prev` revisions).
   - Supports parsing, structural mutation, page tree splicing/merging/splitting, metadata/XMP editing, standard encryption/decryption (RC4 and AES-128/256), QDF-style deterministic normalization, incremental saves, and full serialization.
2. **Layer 2 — Content Stream & 2D Display List AST (`PdfContentAst` & `PdfDisplayList`)**:
   - Bidirectional parser and emitter for page and XObject content stream operators (`q`/`Q`, `cm`, color spaces, path construction/painting/clipping `m`/`l`/`c`/`re`/`W`/`S`/`f`/`B`, text state & positioning `BT`/`ET`/`Tf`/`Tm`/`Td`/`TD`/`Tj`/`TJ`, XObjects `Do`, inline images `BI`/`ID`/`EI`, and marked content `BMC`/`BDC`/`EMC` with `/ActualText` and `/MCID`).
   - Evaluates any page's content stream + font resources into a resolved **2D Display List (`PdfDisplayList`)** of positioned `GlyphSpan`s (exact bounding boxes, baselines, matrices, raw character codes, and decoded Unicode), `VectorPath`s, `PlacedImage`s, and `PageAnnotation`s.
   - Provides both an imperative/declarative **Page Canvas API** (`page.drawText`, `page.drawRect`, `page.drawPath`, `page.drawImage`, `page.pushClip`/`popClip`) for producers (`ssconvert`, `wkhtmltopdf`, `soffice`) and a **first-party 2D scanline PNG rasterizer** (`renderPageToPng`) for previewing, visual QA, and OCR pipelines without native dependencies.
3. **Layer 3 — High-Level Layout, Structure Tree & Extraction AST (`PdfLayoutAst` & `PdfExtractedPage`)**:
   - **Read/Extract (`extractPage` / `pdfToDocumentAst`)**: Reconstructs geometric lines, words, characters (`bbox`), multi-column reading order, ruled and whitespace tables (`extractTables`), links, outlines, AcroForm fields, and `/StructTreeRoot` logical tags. Directly powers `pdftotext` (logical, `-layout`, `-raw`, `-bbox`), `pdfinfo`, and `pandoc`'s PDF reader (`read: true`).
   - **Write/Edit (`renderLayoutDocument` / `editPdf`)**: Upgrades `LayoutDocument` with spanned tables (`rowSpan`/`colSpan`, cell borders, fills, alignments), positioned boxes, running headers/footers (`pageNumber`/`totalPages`), outlines, AcroForm creation/filling/flattening, and true content-stream redaction (purging underlying glyphs/vectors/image samples within redaction rectangles rather than overlaying black rectangles).

**Explicit non-goals**:
- Executing embedded PDF JavaScript, XFA dynamic scripting, or launching external host binaries (`gs`, `qpdf`, `pdftotext`, `soffice`, `wkhtmltopdf`, Chromium).
- Ambient filesystem or network fetches inside `@poe-code/pdf` (all fonts, CMap assets, images, and documents are passed as `Uint8Array` or bounded streams).
- Including third-party library names or attributions in user-facing CLI output, `--help`, or `README.md`.

## 2. User-facing shape

### Unified TypeScript SDK (`@poe-code/pdf`)

```ts
import {
  PdfDocument,
  renderLayoutPdf,
  extractPdfText,
  extractPdfTables,
  renderPdfPageToPng,
  suppliedDefaultFont,
} from "@poe-code/pdf";

// 1. Create or load & edit a PDF (high-level builder + COS access)
const doc = await PdfDocument.load(existingPdfBytes, {
  password: "",
  recovery: "strict", // "strict" | "repair"
  limits: { maxObjects: 100_000, maxDecodedBytes: 64_000_000 },
});

doc.setMetadata({
  title: "Quarterly Report",
  author: "Analytics",
  keywords: ["finance", "q3"],
});

const font = doc.embedFont(suppliedDefaultFont.bytes);
const page = doc.addPage({ width: 595.28, height: 841.89 });
page.drawRect({ x: 48, y: 760, width: 500, height: 32, fill: { r: 0.94, g: 0.96, b: 1 } });
page.drawText("Executive Summary", { x: 60, y: 770, font, size: 16, color: { r: 0.06, g: 0.09, b: 0.16 } });

// True content-stream redaction (removes underlying glyphs/paths/images in box)
doc.getPage(0).redact({ x: 100, y: 400, width: 180, height: 24, replacementText: "[REDACTED]" });

// Page slicing / merging / QDF normalization
const subset = await PdfDocument.create();
subset.copyPagesFrom(doc, [0, 2]);
const savedBytes = await subset.save({ deterministic: true, normalizeContent: true });

// 2. Extract structured AST, text modes, and tables (for pdftotext, pandoc reader, etc.)
const pageLayout = doc.getPage(0).analyzeLayout();
const logicalText = doc.extractText({ mode: "logical" }); // "logical" | "layout" | "raw" | "bbox"
const tables = doc.getPage(0).extractTables();

// 3. Rasterize any PDF page to PNG bytes in pure TypeScript (for visual QA & pdf2image)
const pngBytes = await renderPdfPageToPng(doc, 0, { scale: 2 });
```

### Consumer Package Integration Shape

| Consumer Package | How it uses `@poe-code/pdf` |
| --- | --- |
| `packages/pandoc` | **Writer**: maps Pandoc `Document` AST to `LayoutDocument` v2 (with spanned tables, styled runs, headers/footers). **Reader (`read: true`)**: maps `doc.toSemanticAst()` (headings, paragraphs, lists, tables, links, images) into Pandoc `Document` AST. |
| `packages/ssconvert` | Replaces direct `pdf-lib` imports in `src/codecs/pdf.ts` with `PdfDocument` + `PdfPage` canvas drawing (`drawRect`, `pushClip`, `drawText`, `drawPath`). |
| `packages/safe-bash-command-wkhtmltopdf` | Binds `StaticRenderer` to the CSS Box -> `PdfPage` / `LayoutDocument` v2 pagination and canvas pipeline. |
| `packages/safe-bash-command-pdfinfo` | Reads `doc.inspectInfo()` (boxes, rotation, page sizes, Info dictionary, XMP metadata bytes, encryption/permissions summary, PDF version, linearized status). |
| `packages/safe-bash-command-pdftotext` | Calls `doc.extractText({ mode: "logical" \| "layout" \| "raw" \| "bbox", firstPage, lastPage, cropBox, eol, nopgbrk })`. |
| `packages/safe-bash-command-qpdf` | Uses Layer 1 `PdfCosDocument` for `--check`, `--json`, `--pages` range selection/collation, `--split-pages`, `--decrypt`, `--qdf`, and `--preserve-unreferenced`. |
| `packages/safe-bash-command-exiftool` | Uses Layer 1 `PdfCosDocument` to read and reversibly update `/Info` and `/Metadata` (XMP) via incremental update or full rewrite. |

## 3. Implementation details and technical decisions

### Autonomy audit

- **Retain `pako`, drop `pdf-lib` and `@pdf-lib/fontkit`**: `packages/pdf/package.json` keeps `pako` (`3.0.1`) for bounded zlib/deflate/inflate streams (`FlateDecode` and PNG chunk compression/decompression) and removes `pdf-lib` and `@pdf-lib/fontkit`.
- **Packaged font & CMap assets**: `packages/pdf` already includes the licensed default TrueType font (`src/default-font.ts` with `OFL.txt`) and `src/font-admission.ts`. Extend first-party font support with compact static tables for the 14 standard PDF base fonts' width/encoding metrics (`WinAnsiEncoding`, `MacRomanEncoding`, `StandardEncoding`, `Symbol`, `ZapfDingbats`, Adobe Glyph List lookup) and predefined `Identity-H`/`Identity-V` CMap decoders so text extraction on PDFs without embedded fonts works offline without external asset fetches.
- **Compression & crypto primitives**: Use `pako` (`Inflate` / `deflate`) with bounded chunk admission + first-party PNG/TIFF predictor filters, LZW, ASCII85, ASCIIHex, and RunLength codecs, plus WebCrypto (`crypto.subtle`) and pure-TS RC4/AES-CBC/SHA-256/384/512 primitives for PDF standard security handlers (R2–R6).
- **In-memory visual verification (`renderPdfPageToPng`)**: Provide a built-in pure-TS 4x4 subpixel antialiased scanline rasterizer that renders `PdfDisplayList` (vector paths, clipped rects, placed images, and TrueType glyph outlines from `glyf` contours + fallback bitmap/vector glyphs for standard 14 fonts) into an RGBA buffer and encodes RFC 2083 PNG bytes. Agents can render any generated or edited PDF page to `/out/.../*.png` and inspect it directly with `view_image`.

### Architecture & Layer Breakdown

1. **Layer 1: COS Lexer, XRef/Revision Resolver & Serializer (`src/cos/`)**
   - **Byte Lexer (`src/cos/lexer.ts`)**: Operates on `Uint8Array` without UTF-8 string coercion. Emits tokens with exact `[startOffset, endOffset]` spans. Preserves raw bytes on `PdfName` (decoding `#XX` separately) and `PdfString` (`literal` with balanced parens/octal escapes vs `hex` with odd-nibble padding). Rejects unsafe integers (`> Number.MAX_SAFE_INTEGER`) in offsets/object IDs while retaining raw numeric tokens.
   - **XRef & Incremental Revision Graph (`src/cos/xref.ts`)**: Resolves newest-first `/Prev` chains, classic `xref` tables, cross-reference streams (`/Type /XRef` with `/W` field widths and `/Index`), hybrid `/XRefStm`, and `/ObjStm` compressed object streams. Tracks visited offsets to reject cycle attacks and offers an explicit `recovery: "repair"` bounded object scan mode when `startxref` is damaged.
   - **Filter Pipeline (`src/cos/filters.ts`)**: Chained decoding/encoding for `FlateDecode` (with TIFF predictor 2 and PNG predictors 10–15), `LZWDecode` (`EarlyChange`), `ASCIIHexDecode`, `ASCII85Decode`, and `RunLengthDecode`, plus pass-through/inspection headers for `DCTDecode` (JPEG) and `JPXDecode`/`CCITTFaxDecode` under shared `decodedBytes` budgets.
   - **Standard Security Handler (`src/cos/security.ts`)**: Implements standard `/Filter /Standard` revisions R2–R6 (40/128-bit RC4, 128-bit AES-CBC, 256-bit AES-CBC with R5/R6 SHA-256/384/512 modulo-3 key derivation, `/StmF`, `/StrF`, `/EFF`, and `/EncryptMetadata`).
   - **Deterministic & Incremental Serializer (`src/cos/writer.ts`)**: Replaces `pdf-lib` serialization. Supports full rewrite, QDF-normalized rewrite (stream expansion, deterministic content stream formatting, object renumbering), and incremental append (`%%EOF` + delta `xref` section for reversible metadata edits).

2. **Layer 2: Content Stream AST, Font Engine & Display List (`src/content/`, `src/fonts/`, `src/render/`)**
   - **Content Stream Parser & Serializer (`src/content/parser.ts`, `src/content/serializer.ts`)**: Parses page/XObject content streams into typed `PdfContentOp` AST nodes. Handles `BI`/`ID`/`EI` inline image length/terminator rules, nested `q`/`Q` graphics state stacks, `BT`/`ET` text objects, and `BMC`/`BDC`/`EMC` marked-content trees.
   - **Font & Unicode Engine (`src/fonts/`)**:
     - **Reading**: Maps character codes to Unicode via `/ToUnicode` CMap streams (`beginbfchar`/`beginbfrange`, UTF-16BE multi-codepoint ligatures and surrogates), `/Encoding` (`/Differences` + base encoding), and embedded TrueType `cmap` tables. Computes glyph advances in text space from `/Widths`, `/W` (CID), and `hmtx`.
     - **Writing**: Parses TrueType/OpenType (`head`, `hhea`, `maxp`, `os2`, `post`, `loca`, `glyf`, `hmtx`, `cmap`), embeds font descriptors + streams, and generates `/ToUnicode` CMaps so emitted text is 100% extractable without `@pdf-lib/fontkit`.
   - **2D Display List Evaluator & Canvas (`src/content/evaluator.ts`, `src/canvas.ts`)**: Evaluates content operators against the CTM (`[a b c d e f]`) and text matrix (`Tm * Tlm * CTM`) to emit `PdfDisplayList` items (`GlyphRunItem`, `PathItem`, `ImageItem`, `ClipGroup`). Simultaneously provides the builder methods (`drawText`, `drawRect`, `drawLine`, `drawPath`, `drawImage`) that append typed `PdfContentOp` nodes when creating or editing pages.

3. **Layer 3: Extraction, Layout & Structural Editing (`src/extract/`, `src/layout/`, `src/edit/`)**
   - **Text & Layout Extractor (`src/extract/text.ts`)**:
     - `raw`: Content-stream order with form feeds (`\f`) per page.
     - `logical`: Poppler-inspired spatial clustering into lines, columns, blocks, and paragraphs with soft-hyphen rejoining (`remove-hyphens`) and `/Span /ActualText` replacement.
     - `layout`: Fixed-pitch 2D grid projection preserving horizontal column spacing and vertical line gaps.
     - `bbox`: Per-word/character bounding box coordinates in page points.
   - **Table & Semantic AST Extractor (`src/extract/tables.ts`, `src/extract/semantic-ast.ts`)**: Detects ruled table grids (from horizontal/vertical `PathItem` strokes/fills) and whitespace-aligned column grids; converts pages into a high-level `PdfSemanticNode[]` (`Heading`, `Paragraph`, `List`, `Table`, `Figure`, `Link`) for `pandoc` PDF reading.
   - **Document Layout v2 (`src/layout/engine.ts`)**: Extends `LayoutDocument` with spanned `TableBlock` (`rowSpan`, `colSpan`, cell borders, background colors, horizontal/vertical alignment), styled `TextRun` (bold/italic/monospace font bindings, underline, strikeout, color, background), running headers/footers, and multi-column sections.
   - **Structural Editor (`src/edit/`)**: Page tree manipulation (`copyPages`, `removePages`, `splitPages`, `mergeDocuments` with inherited `MediaBox`/`CropBox`/`Rotate`/`Resources` flattening and label rebasing), `AcroForm` field inspection/filling, and true geometric content-stream redaction (`redactRect`).

## 4. Interfaces and test plan

### Core AST & SDK Interfaces (`packages/pdf/src/ast.ts`)

```ts
// Layer 1: COS AST
export type PdfCosNode =
  | { readonly kind: "null"; readonly span?: ByteSpan }
  | { readonly kind: "boolean"; readonly value: boolean; readonly span?: ByteSpan }
  | { readonly kind: "number"; readonly value: number; readonly raw: string; readonly isInteger: boolean; readonly span?: ByteSpan }
  | { readonly kind: "name"; readonly decoded: string; readonly rawBytes: Uint8Array; readonly span?: ByteSpan }
  | { readonly kind: "string"; readonly format: "literal" | "hex"; readonly bytes: Uint8Array; readonly span?: ByteSpan }
  | { readonly kind: "array"; readonly items: PdfCosNode[]; readonly span?: ByteSpan }
  | { readonly kind: "dict"; readonly entries: PdfDictEntry[]; readonly span?: ByteSpan }
  | { readonly kind: "stream"; readonly dict: PdfCosDict; readonly rawBytes: Uint8Array; readonly decodedBytes?: Uint8Array; readonly span?: ByteSpan }
  | { readonly kind: "ref"; readonly objectNumber: number; readonly generationNumber: number; readonly span?: ByteSpan };

export interface PdfDictEntry {
  readonly key: PdfCosName;
  readonly value: PdfCosNode;
}

// Layer 2: Content Stream & Display List AST
export type PdfContentNode =
  | { readonly kind: "graphics-group"; readonly ops: PdfContentNode[] } // q ... Q
  | { readonly kind: "marked-content"; readonly tag: string; readonly properties?: PdfCosDict | string; readonly actualText?: string; readonly mcid?: number; readonly children: PdfContentNode[] } // BMC/BDC ... EMC
  | { readonly kind: "text-object"; readonly commands: PdfTextCommand[] } // BT ... ET
  | { readonly kind: "path-op"; readonly segments: PdfPathSegment[]; readonly paint: "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n"; readonly clip?: "W" | "W*" }
  | { readonly kind: "xobject"; readonly name: string } // Do
  | { readonly kind: "state-op"; readonly operator: string; readonly operands: PdfCosNode[] };

export interface PdfPlacedGlyph {
  readonly charCode: number;
  readonly unicode: string;
  readonly bbox: PdfRect; // [xMin, yMin, xMax, yMax] in page points
  readonly origin: readonly [number, number];
  readonly fontSize: number;
  readonly fontName: string;
  readonly angleRad: number;
}

export interface PdfDisplayList {
  readonly pageNumber: number;
  readonly mediaBox: PdfRect;
  readonly cropBox: PdfRect;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly glyphs: readonly PdfPlacedGlyph[];
  readonly paths: readonly PdfEvaluatedPath[];
  readonly images: readonly PdfEvaluatedImage[];
  readonly links: readonly PdfLinkAnnotation[];
}

// Layer 3: Extracted & Semantic Page AST
export interface PdfExtractedPage {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly blocks: readonly PdfTextBlock[];
  readonly tables: readonly PdfExtractedTable[];
  readonly links: readonly PdfLinkAnnotation[];
}
```

### Test Plan

- **Unit tests (`packages/pdf/src/**/*.test.ts`, in-memory `memfs`)**:
  - **COS & XRef (`src/cos/*.test.ts`)**: Classic `xref`, `/Type /XRef` streams, `/ObjStm` compressed objects, incremental `/Prev` revisions, hybrid `/XRefStm`, octal/hex string escapes, `#XX` name escapes, duplicate dictionary keys, cycle detection, and damaged-`startxref` recovery.
  - **Filters & Security (`src/cos/filters.test.ts`, `src/cos/security.test.ts`)**: Flate + PNG/TIFF predictors, LZW `EarlyChange`, ASCII85, ASCIIHex, RunLength, and R2–R6 RC4/AES-128/AES-256 key derivation and stream/string decryption.
  - **Content AST, Fonts & Extraction (`src/content/*.test.ts`, `src/extract/*.test.ts`)**: `BT`/`ET` matrices, `TJ` kerning shifts, `/ToUnicode` ligatures/surrogates, `/Span /ActualText` replacement, rotated/multi-column reading order, hyphen removal, and ruled/whitespace table extraction.
  - **Round-trip, Redaction & Rasterization (`src/edit/*.test.ts`, `src/render/*.test.ts`)**: Page splitting/merging with inherited `MediaBox`/`Resources`, `AcroForm` field updates, true content-stream redaction (verifying redacted strings are absent from both `extractText` and raw serialized streams), and `renderPdfPageToPng` RGBA/PNG output verification.
- **Real-world verification**:
  1. Render multi-page documents with spanned tables, styled typography, vector shapes, and embedded PNG/JPEG images via `@poe-code/pdf`, rasterize each page to `/out/pdf-qa/*.png` via `renderPdfPageToPng`, and inspect every page with `view_image`.
  2. Round-trip the generated PDFs through `PdfDocument.load`, extract logical/layout/bbox text and tables, split/merge pages, redact regions, and re-verify both parsed COS structure and rendered PNGs.
  3. Run `pandoc` (`md -> pdf` and `pdf -> md`) and `ssconvert` (`xlsx -> pdf`) using the zero-dependency `@poe-code/pdf` engine and verify all existing Pandoc and `ssconvert` PDF suites pass without `pdf-lib`.

### Must-work checklist

- [ ] `packages/pdf/package.json` retains only `"pako": "3.0.1"` (dropping `pdf-lib` and `@pdf-lib/fontkit`) and passes `npm test --workspace=@poe-code/pdf`.
- [ ] `PdfDocument.load` parses classic xrefs, xref streams, object streams, incremental revisions, and encrypted R2–R6 fixtures into a lossless `PdfCosDocument` AST.
- [ ] `doc.extractText({ mode })` matches expected `logical`, `layout`, `raw`, and `bbox` outputs on multi-page, multi-column, hyphenated, and `/ActualText` fixtures.
- [ ] `page.redact(rect)` permanently removes underlying glyph/path/image operators inside `rect` from the serialized PDF bytes and `extractText` output.
- [ ] `renderPdfPageToPng` renders pages to crisp 2x PNGs inspected via `view_image`, and `packages/pandoc` + `packages/ssconvert` pass their full PDF test suites on top of the new engine.

## 5. Code plan

### Files to create in `packages/pdf`

- `packages/pdf/src/ast.ts` — Canonical types for Layer 1 (`PdfCosNode`, `PdfCosDict`, `PdfCosStream`, `PdfXRefEntry`), Layer 2 (`PdfContentNode`, `PdfDisplayList`, `PdfPlacedGlyph`), and Layer 3 (`PdfExtractedPage`, `PdfExtractedTable`, `PdfSemanticNode`).
- `packages/pdf/src/cos/lexer.ts` — Bounded byte lexer preserving token spans and raw string/name bytes.
- `packages/pdf/src/cos/parser.ts` — Direct and indirect object parser, stream boundary resolver, and `/ObjStm` decompressor.
- `packages/pdf/src/cos/xref.ts` — Classic `xref` table, cross-reference stream, hybrid `/XRefStm`, `/Prev` revision resolver, and bounded repair scanner.
- `packages/pdf/src/cos/filters.ts` — `FlateDecode` (using `pako` + PNG/TIFF predictors), `LZWDecode`, `ASCII85Decode`, `ASCIIHexDecode`, and `RunLengthDecode`.
- `packages/pdf/src/cos/security.ts` — Standard security handler (RC4, AES-128, AES-256 R5/R6) decryptor and encryptor.
- `packages/pdf/src/cos/writer.ts` — Full, QDF-normalized, and incremental COS serializer.
- `packages/pdf/src/fonts/standard14.ts` — Metrics and glyph-name mappings for the 14 standard PDF fonts (`WinAnsi`, `MacRoman`, `Standard`, `Symbol`, `ZapfDingbats`).
- `packages/pdf/src/fonts/cmap.ts` — `/ToUnicode` and CID CMap parser (`beginbfchar`, `beginbfrange`, `Identity-H`/`V`) and `/ToUnicode` generator.
- `packages/pdf/src/fonts/truetype.ts` — First-party TrueType/OpenType parser (`cmap`, `hmtx`, `loca`, `glyf`, `head`, `hhea`, `post`, `os2`) replacing `@pdf-lib/fontkit`.
- `packages/pdf/src/content/parser.ts` & `packages/pdf/src/content/serializer.ts` — Content stream tokenizer, operator AST builder (`BT`/`ET`, `q`/`Q`, `BMC`/`BDC`/`EMC`, `BI`/`ID`/`EI`), and deterministic operator serializer.
- `packages/pdf/src/content/evaluator.ts` — Graphics/text state machine evaluating `PdfContentNode[]` into a positioned `PdfDisplayList`.
- `packages/pdf/src/canvas.ts` — High-level `PdfPage` drawing & editing API (`drawText`, `drawRect`, `drawLine`, `drawPath`, `drawImage`, `pushClip`, `popClip`, `redact`).
- `packages/pdf/src/extract/text.ts` & `packages/pdf/src/extract/tables.ts` — Spatial reading-order clustering (`logical`, `layout`, `raw`, `bbox`), hyphen rejoining, table detection, and `pdfToSemanticAst`.
- `packages/pdf/src/edit/pages.ts` & `packages/pdf/src/edit/forms.ts` — Page tree flattening, inheritance resolution (`MediaBox`/`CropBox`/`Rotate`/`Resources`), page copying/splitting/merging, page-label rebasing, and `AcroForm` inspection/filling.
- `packages/pdf/src/render/raster.ts` — First-party 4x4 subpixel scanline rasterizer (`PdfDisplayList` -> RGBA -> RFC 2083 PNG).
- `packages/pdf/src/document.ts` — Unified `PdfDocument` facade combining Layer 1 (`cos`), Layer 2 (`getPage(i)` canvas & display list), and Layer 3 (`extractText`, `extractTables`, `toSemanticAst`, `save`).

### Files to update

- `packages/pdf/src/model.ts`, `packages/pdf/src/index.ts`, `packages/pdf/src/serialization.ts`, and `packages/pdf/package.json` — Upgrade `LayoutDocument` to v2, re-implement `renderPdf` and `serializePdf` on `PdfDocument`/`src/cos/writer.ts`, export the unified AST and SDK, keep `pako`, and remove `pdf-lib` and `@pdf-lib/fontkit`.
- `packages/ssconvert/src/codecs/pdf.ts` and `packages/ssconvert/package.json` — Replace direct `pdf-lib` and `@pdf-lib/fontkit` imports with `@poe-code/pdf`'s `PdfDocument` and `PdfPage` canvas API.
- `packages/pandoc/src/formats/pdf.ts` and `packages/pandoc/src/pdf-writer.ts` — Add `pdfReader` (`read: true`) using `PdfDocument.load(...).toSemanticAst()` and wire `pdfWriter` to the upgraded `LayoutDocument` v2.

### Build order

1. **Phase 1 — Filter Pipeline (`pako`), TrueType Engine & COS Serializer (`src/cos/filters.ts`, `src/fonts/truetype.ts`, `src/cos/writer.ts`)**: Replace `pdf-lib` and `@pdf-lib/fontkit` (keeping `pako` for Flate/PNG streams) inside `packages/pdf` and `packages/ssconvert` while keeping all 49 existing `packages/pdf` tests, 1,067 `packages/pandoc` tests, and `packages/ssconvert` PDF tests green.
2. **Phase 2 — COS Lexer, XRef/Revision Parser & Security (`src/cos/lexer.ts`, `src/cos/parser.ts`, `src/cos/xref.ts`, `src/cos/security.ts`)**: Land `PdfDocument.load()` and lossless/QDF/incremental `doc.save()`, unlocking `pdfinfo`, `qpdf`, and `exiftool`.
3. **Phase 3 — Content Stream AST, Font/CMap Decoder & Display List (`src/content/`, `src/fonts/cmap.ts`, `src/fonts/standard14.ts`)**: Parse page streams into `PdfContentNode[]` and evaluate `PdfDisplayList`.
4. **Phase 4 — Page Rasterizer (`src/render/raster.ts`)**: Land `renderPdfPageToPng` and visually verify generated and parsed pages with `view_image`.
5. **Phase 5 — Extraction, Redaction, Page Editing & Pandoc Reader (`src/extract/`, `src/edit/`, `packages/pandoc/src/formats/pdf.ts`)**: Land `extractText` (`logical`/`layout`/`raw`/`bbox`), `extractTables`, `page.redact`, `copyPages`/`splitPages`, and Pandoc's `pdf` reader, unlocking `pdftotext`, `qpdf`, `wkhtmltopdf`, and `soffice`.
