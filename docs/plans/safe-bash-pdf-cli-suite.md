---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# Safe-Bash Poppler & PDFtk CLI Suite (`pdftoppm`, `pdfimages`, `pdftk`)

Complete the Poppler and PDFtk CLI suite in `@poe-platform/safe-bash` by adding `pdftoppm`, `pdfimages`, and `pdftk` as zero-dependency, in-memory VFS command packages powered by `@poe-code/pdf-ast`.

## 1. What we're building

Turn `@poe-code/pdf-ast` into a drop-in Poppler + PDFtk CLI suite inside `@poe-platform/safe-bash` by adding three private command packages (`safe-bash-command-pdftoppm`, `safe-bash-command-pdfimages`, and `safe-bash-command-pdftk`) exposed via `@poe-platform/safe-bash/commands/*`:

1. **`pdftoppm`**: Renders PDF pages to raster images (`.png`, `.ppm`, `.pgm`, `.pbm`) or vector `.svg` files at configurable DPI (`-r`, `-rx`, `-ry`), page ranges (`-f`, `-l`), crop geometries (`-x`, `-y`, `-W`, `-H`, `-cropbox`), and output naming conventions (`-singlefile`, `-sep`, `-forcenum`).
2. **`pdfimages`**: Lists (`-list`) and extracts embedded raster images (XObject `/Subtype /Image` and inline `BI ... ID ... EI` images, recursively traversing Form XObjects) to `.png`, `.ppm`/`.pbm`, or raw `.jpg` (`-png`, `-j`, `-f`, `-l`, `-p`) with page/object metadata.
3. **`pdftk`**: Provides PDFtk-compatible document assembly and AcroForm automation (`cat`, `burst`, `dump_data_fields`, `dump_data_fields_utf8`, `dump_data`, `fill_form`, `flatten`, `rotate`, `background`, `stamp`) backed directly by `PdfDocument`, `getDocumentFormFields`, `setDocumentFormField`, and annotation flattening in `@poe-code/pdf-ast`.

### Explicit Non-Goals

- No external runtime dependencies, no native binaries (`poppler-utils`, `pdftk-java`, `ghostscript`), no WASM downloads, and no host filesystem/network access.
- No XFA dynamic XML form script evaluation (`pdftk` operates on standard AcroForm `/Fields` and widget annotations).
- No publishing of `safe-bash-command-*` or `@poe-code/pdf-ast` as standalone npm packages; all three commands are private workspaces bundled into `@poe-platform/safe-bash`.

## 2. User-facing shape

### CLI Usage in `safe-bash`

#### `pdftoppm`

```bash
# Render all pages to PNG at 150 DPI (writes slide-1.png, slide-2.png, ...)
pdftoppm -png -r 150 deck.pdf slide

# Render only page 1 to a single PNG without numeric suffix (writes cover.png)
pdftoppm -png -f 1 -l 1 -singlefile report.pdf cover

# Render a cropped region of page 2 to stdout as PNG
pdftoppm -png -f 2 -l 2 -x 50 -y 50 -W 400 -H 300 report.pdf > region.png

# Render grayscale PGM or monochrome PBM
pdftoppm -gray -f 1 -l 1 invoice.pdf page1
```

#### `pdfimages`

```bash
# Inspect all embedded images with page number, object ID, dimensions, color space, and DPI
pdfimages -list paper.pdf
# page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
# --------------------------------------------------------------------------------------------
#    1     0 image     800   600  rgb     3   8  image   no         7  0    72    72 14.2K 1.0%

# Extract all embedded images as PNGs (writes fig-000.png, fig-001.png, ...)
pdfimages -png paper.pdf fig

# Include page numbers in output filenames (writes fig-001-000.png)
pdfimages -png -p -f 2 -l 4 paper.pdf fig
```

#### `pdftk`

```bash
# Inspect AcroForm fields in PDFtk format
pdftk tax-form.pdf dump_data_fields_utf8
# ---
# FieldType: Text
# FieldName: applicant.full_name
# FieldValue: Ada Lovelace
# FieldFlags: 0
# ---
# FieldType: Button
# FieldName: terms_accepted
# FieldValue: Yes
# FieldStateOption: Off
# FieldStateOption: Yes

# Fill an AcroForm from an FDF/XFDF or key-value data file and flatten into page content
pdftk tax-form.pdf fill_form answers.fdf output tax-form-filled.pdf flatten

# Multi-handle page assembly and rotation
pdftk A=intro.pdf B=appendix.pdf cat A1-2 B1east A3-end output combined.pdf

# Burst a document into single-page PDFs (pg_0001.pdf, pg_0002.pdf, ...) and doc_data.txt
pdftk packet.pdf burst output page_%04d.pdf
```

### SDK Registration & Programmatic API

```ts
import { createShell } from "@poe-platform/safe-bash";
import { pdftoppmPlugin, createPdftoppmCommand } from "@poe-platform/safe-bash/commands/pdftoppm";
import { pdfimagesPlugin, createPdfimagesCommand } from "@poe-platform/safe-bash/commands/pdfimages";
import { pdftkPlugin, createPdftkCommand } from "@poe-platform/safe-bash/commands/pdftk";

const shell = createShell({
  plugins: [pdftoppmPlugin(), pdfimagesPlugin(), pdftkPlugin()]
});
```

## 3. Implementation details and technical decisions

### Autonomy Audit

- **Zero external prerequisites**: All PDF parsing, content evaluation, rasterization (`renderPdfPageToPng`, `renderDisplayListToPng`), and AcroForm mutation (`getDocumentFormFields`, `setDocumentFormField`) already reside in `packages/pdf-ast`.
- **No network or host binaries**: Tests generate synthetic PDFs in-memory via `PdfDocument.create()` and `memfs` / `safe-bash` VFS.
- **Build & bundling pipeline**: Uses existing `scripts/build-workspaces.mjs` and `scripts/package-safe.mjs`. Private command packages depend only on `safe-bash-contracts` and `@poe-code/pdf-ast` (maintaining the strict DAG: `contracts/pdf-ast -> safe-bash-command-* -> safe-bash`).

### Architecture & Engine Enhancements in `@poe-code/pdf-ast`

1. **Embedded Image Extraction (`packages/pdf-ast/src/extract/images.ts`)**:
   - Walk page `/Resources -> /XObject` (recursing into `/Subtype /Form` XObjects with their CTM combined with the page CTM) and inline content stream `BI ... ID ... EI` operators.
   - Decode `/FlateDecode`, `/ASCIIHexDecode`, `/ASCII85Decode`, `/RunLengthDecode`, `/LZWDecode`, and `/DCTDecode` (JPEG passthrough + baseline JPEG decoder for PNG conversion).
   - Return structured `PdfExtractedImage` records containing `pageNumber`, `imageIndex`, `objectRef`, `width`, `height`, `colorSpace` (`rgb` | `gray` | `cmyk` | `index`), `components`, `bitsPerComponent`, `encoding` (`image` | `jpeg` | `flate`), `xPpi`, `yPpi`, raw decoded pixel buffer (`RgbaBitmap`), and original compressed bytes when `encoding === "jpeg"`.
2. **Netpbm (`PPM`/`PGM`/`PBM`) & Crop-Region Encoding (`packages/pdf-ast/src/render/raster.ts`)**:
   - Extend `RenderToPngOptions` with `dpiX`, `dpiY`, `useCropBox`, and `cropRect: { x, y, width, height }` in pixel coordinates.
   - Add `encodePpm(bitmap: RgbaBitmap): Uint8Array` (`P6`), `encodePgm(bitmap: RgbaBitmap): Uint8Array` (`P5` luminance `0.299R + 0.587G + 0.114B`), and `encodePbm(bitmap: RgbaBitmap): Uint8Array` (`P4` 1-bit packed threshold).
3. **FDF / XFDF Parser & Field Option Inspector (`packages/pdf-ast/src/edit/forms.ts`)**:
   - Extend `PdfFormFieldInfo` with `options: string[]` (extracted from `/Opt` arrays and widget `/AP -> /N` appearance state keys) and `flags: number` (`/Ff`).
   - Add `parseFormDataBytes(bytes: Uint8Array): Map<string, string | boolean>` supporting:
     - **FDF** (`%FDF-1.2 ... /Fields [ << /T (name) /V (value) >> ]`),
     - **XFDF** (`<xfdf><fields><field name="..."><value>...</value></field></fields></xfdf>`), and
     - **Simple `key=value` / `dump_data_fields` stanzas** for ergonomic CLI piping.

### Edge Cases & Safety

- **Page numbering padding (`pdftoppm`)**: Poppler pads page numbers to the digit count of `totalPages` (`1..9` -> `1`, `1..10` -> `01..10`, `1..100` -> `001..100`), unless `-singlefile` is passed (which omits `-<page>` and renders only `firstPage`).
- **Circular Form XObjects (`pdfimages`)**: Track visited `objNum:genNum` keys when traversing nested `/Subtype /Form` `/Resources` to prevent infinite recursion on malformed PDFs.
- **PDFtk handle grammar (`pdftk`)**: Support both named handles (`A=one.pdf B=two.pdf cat A1-3 B2south`) and implicit single-input ranges (`in.pdf cat 1-endeast`). Rotation tokens support both PDFtk 1.44 (`N`, `E`, `S`, `W`, `L`, `R`, `D`) and PDFtk Server (`north`, `east`, `south`, `west`, `left`, `right`, `down`).
- **Resource accounting**: Charge rendered bitmap buffers (`width * height * 4` bytes) and output file bytes against `CommandContext` memory/output operations.

## 4. Interfaces and test plan

### Module-Boundary Signatures

```ts
// packages/pdf-ast/src/extract/images.ts
export interface PdfExtractedImage {
  readonly pageNumber: number;
  readonly imageIndex: number;
  readonly objectId?: { readonly objNum: number; readonly genNum: number };
  readonly inline: boolean;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "rgb" | "gray" | "cmyk" | "index";
  readonly components: number;
  readonly bitsPerComponent: number;
  readonly encoding: "image" | "jpeg" | "ccitt" | "jbig2" | "jpx";
  readonly interpolate: boolean;
  readonly xPpi: number;
  readonly yPpi: number;
  readonly byteLength: number;
  readonly bitmap: RgbaBitmap;
  readonly rawJpegBytes?: Uint8Array;
}

export function extractDocumentImages(
  doc: ParsedCosDocument,
  options?: { readonly firstPage?: number; readonly lastPage?: number }
): PdfExtractedImage[];
```

```ts
// packages/pdf-ast/src/render/raster.ts
export function encodePpm(bitmap: RgbaBitmap): Uint8Array;
export function encodePgm(bitmap: RgbaBitmap): Uint8Array;
export function encodePbm(bitmap: RgbaBitmap): Uint8Array;
```

```ts
// packages/pdf-ast/src/edit/forms.ts
export function parseFormDataBytes(bytes: Uint8Array): Map<string, string | boolean>;
```

```ts
// packages/safe-bash-command-pdftoppm/src/index.ts
export function createPdftoppmCommand(options?: PdftoppmCommandOptions): CommandDefinition;
export function pdftoppmPlugin(options?: PdftoppmCommandOptions): VirtualShellPlugin;

// packages/safe-bash-command-pdfimages/src/index.ts
export function createPdfimagesCommand(options?: PdfimagesCommandOptions): CommandDefinition;
export function pdfimagesPlugin(options?: PdfimagesCommandOptions): VirtualShellPlugin;

// packages/safe-bash-command-pdftk/src/index.ts
export function createPdftkCommand(options?: PdftkCommandOptions): CommandDefinition;
export function pdftkPlugin(options?: PdftkCommandOptions): VirtualShellPlugin;
```

### Test Plan

1. **`@poe-code/pdf-ast` Unit Tests**:
   - `packages/pdf-ast/src/extract/images.test.ts`: Verifies extraction of direct XObject images, nested `/Form` XObject images, and inline `BI/ID/EI` images with DPI computation from CTM scaling.
   - `packages/pdf-ast/src/render/raster.test.ts`: Verifies `encodePpm`, `encodePgm`, `encodePbm`, DPI scaling (`-r 72` vs `-r 144`), and sub-rectangle cropping (`-x`, `-y`, `-W`, `-H`).
   - `packages/pdf-ast/src/edit/forms.test.ts`: Verifies `parseFormDataBytes` on FDF, XFDF, and `key=value` inputs, plus `options` discovery for checkboxes/radio buttons.
2. **Command Unit & VFS Integration Tests**:
   - `packages/safe-bash-command-pdftoppm/src/index.test.ts`: Tests `-png`, `-gray`, `-mono`, `-svg`, `-r`, `-rx`/`-ry`, `-f`/`-l`, `-singlefile`, `-x`/`-y`/`-W`/`-H`, `-cropbox`, and stdin/stdout piping.
   - `packages/safe-bash-command-pdfimages/src/index.test.ts`: Tests `-list` column formatting, `-png`, `-j`, `-p`, `-f`/`-l`, and cycle protection on recursive Form XObjects.
   - `packages/safe-bash-command-pdftk/src/index.test.ts`: Tests `dump_data_fields_utf8`, `fill_form` (with and without `flatten`), `cat` with multi-handle page ranges and relative/absolute rotations (`east`, `south`, `down`), `burst`, `background`, and `stamp`.
3. **Packaging & Bundling Verification**:
   - `npx vitest run scripts/package-safe.test.ts scripts/safe-command-publication.test.ts scripts/bundle-safe-bash-private.test.ts` proves all three private commands bundle into `@poe-platform/safe-bash` with rewritten declarations and zero leaked private specifiers.

### Real-World Test

1. Run focused workspace unit tests:
   ```bash
   npx vitest run packages/pdf-ast packages/safe-bash-command-pdftoppm packages/safe-bash-command-pdfimages packages/safe-bash-command-pdftk
   ```
2. Build workspaces and run packaging admission checks:
   ```bash
   npm run build:workspaces -- --workspace=@poe-platform/safe-bash
   npx vitest run scripts/bundle-safe-bash-private.test.ts scripts/package-safe.test.ts
   ```

### Must-Work Checklist

- [x] `pdftoppm -png -r 150 doc.pdf page` writes valid PNG files (`\x89PNG\r\n\x1a\n`) scaled to `widthPt * 150 / 72` x `heightPt * 150 / 72` with Poppler zero-padded page suffixes.
- [x] `pdftoppm -png -singlefile -f 2 -l 2 doc.pdf thumb` writes `thumb.png` for page 2 without a trailing `-2` suffix.
- [x] `pdfimages -list doc.pdf` outputs the exact Poppler table header and one row per embedded/inline image with accurate dimensions and object IDs.
- [x] `pdfimages -png doc.pdf img` extracts embedded images to `img-000.png`, `img-001.png` matching original image pixel dimensions.
- [x] `pdftk form.pdf dump_data_fields_utf8` lists every AcroForm field (`FieldType`, `FieldName`, `FieldValue`, `FieldStateOption`).
- [x] `pdftk form.pdf fill_form data.fdf output filled.pdf flatten` populates field values, bakes appearance streams into page content, and removes interactive widget annotations.
- [x] `pdftk A=a.pdf B=b.pdf cat A1-2 B1east output merged.pdf` produces a 3-page PDF with page 3 rotated +90 degrees and inherited page resources preserved.

## 5. Code plan

### Files to Create

- `packages/pdf-ast/src/extract/images.ts` — XObject and inline image extractor with CTM PPI calculation and circular Form XObject guard.
- `packages/pdf-ast/src/extract/images.test.ts` — Unit tests for image extraction and PPI calculation.
- `packages/safe-bash-command-pdftoppm/package.json` — Private command workspace manifest (`safe-bash-command-pdftoppm`).
- `packages/safe-bash-command-pdftoppm/tsconfig.json` — Workspace TypeScript configuration.
- `packages/safe-bash-command-pdftoppm/src/index.ts` — `pdftoppm` CLI/SDK implementation (`createPdftoppmCommand`, `pdftoppmPlugin`).
- `packages/safe-bash-command-pdftoppm/src/index.test.ts` — Unit and VFS shell tests for `pdftoppm`.
- `packages/safe-bash-command-pdfimages/package.json` — Private command workspace manifest (`safe-bash-command-pdfimages`).
- `packages/safe-bash-command-pdfimages/tsconfig.json` — Workspace TypeScript configuration.
- `packages/safe-bash-command-pdfimages/src/index.ts` — `pdfimages` CLI/SDK implementation (`createPdfimagesCommand`, `pdfimagesPlugin`).
- `packages/safe-bash-command-pdfimages/src/index.test.ts` — Unit and VFS shell tests for `pdfimages`.
- `packages/safe-bash-command-pdftk/package.json` — Private command workspace manifest (`safe-bash-command-pdftk`).
- `packages/safe-bash-command-pdftk/tsconfig.json` — Workspace TypeScript configuration.
- `packages/safe-bash-command-pdftk/src/index.ts` — `pdftk` CLI/SDK implementation (`createPdftkCommand`, `pdftkPlugin`).
- `packages/safe-bash-command-pdftk/src/index.test.ts` — Unit and VFS shell tests for `pdftk`.
- `packages/safe-bash/src/commands/pdftoppm/index.ts` — Re-export shim for `@poe-platform/safe-bash/commands/pdftoppm`.
- `packages/safe-bash/src/commands/pdfimages/index.ts` — Re-export shim for `@poe-platform/safe-bash/commands/pdfimages`.
- `packages/safe-bash/src/commands/pdftk/index.ts` — Re-export shim for `@poe-platform/safe-bash/commands/pdftk`.

### Files to Change

- `packages/pdf-ast/src/render/raster.ts` — Add `encodePpm`, `encodePgm`, `encodePbm`, `dpiX`/`dpiY`, `useCropBox`, and `cropRect` support to `renderPdfPageToPng` / `renderPdfPageToBitmap`.
- `packages/pdf-ast/src/edit/forms.ts` — Add `options` and `flags` to `PdfFormFieldInfo` and export `parseFormDataBytes` for FDF/XFDF/key-value parsing.
- `packages/pdf-ast/src/index.ts` — Re-export `./extract/images.js`, `encodePpm`/`encodePgm`/`encodePbm`, and `parseFormDataBytes`.
- `packages/safe-bash/package.json` — Add `./commands/pdftoppm`, `./commands/pdfimages`, and `./commands/pdftk` subpath exports and workspace dependencies.
- `packages/safe-bash/src/commands/index.ts` — Export the new command factories and plugins.

### Build Order

1. Extend `@poe-code/pdf-ast` (`extract/images.ts`, `render/raster.ts`, `edit/forms.ts`) and run `packages/pdf-ast` unit tests.
2. Create `packages/safe-bash-command-pdftoppm`, `packages/safe-bash-command-pdfimages`, and `packages/safe-bash-command-pdftk` with unit tests.
3. Wire subpath exports in `packages/safe-bash` and verify workspace build + private bundle tests (`scripts/bundle-safe-bash-private.test.ts`).
