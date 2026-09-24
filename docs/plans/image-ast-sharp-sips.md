---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# `@poe-code/image-ast` (`sharp` Core) & `safe-bash` `sips` / `identify` CLI

Zero-dependency TypeScript image processing AST and pixel pipeline (`@poe-code/image-ast`) with a `sharp`-compatible fluent API, powering `sips` and `identify` inside `@poe-platform/safe-bash` and `sharp` inside `@poe-platform/safe-js`.

## 1. What we're building

Build the image processing equivalent of `@poe-code/pdf-ast` in two layers:

1. **`@poe-code/image-ast` (`packages/image-ast`)**: A private, zero-dependency, in-memory image AST and pixel pipeline exposing a **`sharp`-compatible API** (`sharp(input, options)`):
   - **Codecs**: Pure-TypeScript decoders and encoders for **PNG**, **JPEG** (baseline/progressive DCT decode + baseline Huffman DCT encode), **WebP** (VP8L lossless + RIFF container), **GIF**, and **Netpbm (`PPM`/`PGM`/`PBM`)**, plus **SVG** and **PDF** input rasterization via `@poe-code/pdf-ast`.
   - **Inspection**: `.metadata()` (dimensions, format, channels, color space, DPI, alpha, EXIF orientation) and `.stats()` (per-channel min, max, sum, mean, stdev, opacity, dominant RGB).
   - **Lazy Operation AST**: `.resize()` (`cover`, `contain`, `fill`, `inside`, `outside` with Lanczos-3 / bilinear / nearest kernels), `.extract()`, `.trim()`, `.extend()`, `.rotate()` (arbitrary angles + auto-EXIF orientation), `.flip()`, `.flop()`, `.composite()` (Porter-Duff alpha blending + SVG overlays), `.grayscale()`, `.flatten()`, `.negate()`, `.modulate()`, `.blur()`, `.sharpen()`, and `.threshold()`.
2. **`safe-bash-command-sips` (`packages/safe-bash-command-sips`)**: A zero-dependency VFS command package for `@poe-platform/safe-bash` implementing macOS **`sips`** (Scriptable Image Processing System) plus a lightweight **`identify`** command alias for dimension/format inspection.

### Explicit Non-Goals

- No native `libvips` C++ addons, no `node-gyp`, no WASM binaries, and no external runtime npm dependencies.
- No sprawling ImageMagick 300-flag state machine; CLI surface is strictly `sips` (`-g`, `-s`, `-Z`, `-z`, `-c`, `-p`, `-r`, `-f`, `-o/--out`) plus `identify` (`identify [-ping] [-format ...] <file>...`).
- No standalone npm publication of `@poe-code/image-ast` or `safe-bash-command-sips` (`"private": true`, bundled directly into `@poe-platform/safe-bash` and `@poe-platform/safe-js`).

## 2. User-facing shape

### A. Library / `safe-js` Usage (`@poe-code/image-ast` / `sharp`)

```ts
import sharp from "@poe-code/image-ast";

// 1. Inspect metadata & channel statistics without full re-encoding
const meta = await sharp(inputBytes).metadata();
// => { format: "png", width: 1920, height: 1080, space: "srgb", channels: 4, depth: "uchar", density: 144, hasAlpha: true }

// 2. Fluent operation pipeline (resize -> crop -> composite badge -> encode JPEG)
const { data, info } = await sharp(inputBytes)
  .rotate() // auto-orient from EXIF
  .resize(800, 600, { fit: "cover", position: "centre", kernel: "lanczos3" })
  .composite([{ input: badgePngBytes, gravity: "southeast", blend: "over" }])
  .modulate({ brightness: 1.05, saturation: 1.1 })
  .jpeg({ quality: 85 })
  .toBuffer({ resolveWithObject: true });

// 3. Render a PDF page or SVG directly through sharp() via @poe-code/pdf-ast
const slidePng = await sharp(pdfBytes, { page: 0, density: 150 })
  .extract({ left: 40, top: 40, width: 600, height: 400 })
  .png()
  .toBuffer();
```

### B. `safe-bash` CLI Usage (`sips` & `identify`)

```bash
# Query specific image properties or all properties
sips -g pixelWidth -g pixelHeight -g format hero.png
# /workspace/hero.png
#   pixelWidth: 1920
#   pixelHeight: 1080
#   format: png

# Proportional resize so longest edge is 800px and convert to JPEG (quality 85%)
sips -Z 800 -s format jpeg -s formatOptions 85 hero.png --out hero-thumb.jpg

# Exact resize (height=600, width=800) in-place
sips -z 600 800 chart.png

# Center crop to 400x400, rotate 90 degrees clockwise, and pad to 500x500 with white background
sips -c 400 400 -r 90 -p 500 500 --padColor FFFFFF avatar.png --out avatar-card.png

# Quick one-line inspection via `identify`
identify hero.png hero-thumb.jpg
# hero.png PNG 1920x1080 1920x1080+0+0 8-bit sRGB 142050B 0.000u 0:00.000
# hero-thumb.jpg JPEG 800x450 800x450+0+0 8-bit sRGB 31840B 0.000u 0:00.000
```

### C. SDK Plugin Registration

```ts
import { createShell } from "@poe-platform/safe-bash";
import { sipsPlugin, createSipsCommand, createIdentifyCommand } from "@poe-platform/safe-bash/commands/sips";

const shell = createShell({
  plugins: [sipsPlugin()] // registers both `sips` and `identify`
});
```

## 3. Implementation details and technical decisions

### Autonomy Audit

- **Zero external prerequisites**: Pure TypeScript implementation using existing `@poe-code/pdf-ast` Flate/PNG primitives and newly added pure-TS JPEG DCT / WebP / GIF codecs.
- **Deterministic & bounded**: All decoders enforce pixel dimension caps (`maxInputPixels`, defaulting to `268402689` = `16383 x 16383`, matching `sharp`) and report allocations to `CommandContext` when invoked from `safe-bash`.

### Architecture

1. **Declarative Image AST (`packages/image-ast/src/ast.ts`)**:
   - Every `sharp(input)` instance builds an immutable list of `ImageAstNode` descriptors:
     - `SourceNode` (`bytes` | `rawBuffer` | `createSolidColor`, `page`, `density`)
     - `OrientNode` (`angle: 0 | 90 | 180 | 270 | number`, `autoExif: boolean`, `background`)
     - `ExtractNode` (`left`, `top`, `width`, `height`)
     - `TrimNode` (`threshold`, `background`)
     - `ResizeNode` (`width`, `height`, `fit`, `position`, `kernel`, `withoutEnlargement`, `withoutReduction`, `background`)
     - `ExtendNode` (`top`, `bottom`, `left`, `right`, `background`)
     - `CompositeNode` (`layers: Array<{ input, top, left, gravity, blend, premultiplied }>`)
     - `ColorTransformNode` (`grayscale`, `negate`, `flatten`, `gamma`, `modulate`, `tint`, `threshold`)
     - `ConvolveNode` (`blurSigma` | `sharpen` | `customKernel3x3`)
     - `OutputNode` (`format: "png" | "jpeg" | "webp" | "gif" | "ppm" | "raw"`, `quality`, `compressionLevel`, `lossless`)
2. **Zero-Dependency Codec Suite (`packages/image-ast/src/codecs/`)**:
   - **`png.ts`**: Full 1/2/4/8/16-bit grayscale, RGB, indexed (`PLTE` + `tRNS`), gray+alpha, and RGBA decoder/encoder with `pHYs` DPI chunk read/write.
   - **`jpeg.ts`**: Pure-TS baseline (`SOF0`) & progressive (`SOF2`) Huffman + IDCT decoder (YCbCr/Grayscale/CMYK -> RGBA) with `APP1` EXIF orientation/DPI parser, plus baseline 4:2:0 / 4:4:4 FDCT + Huffman encoder with configurable quality `1..100`.
   - **`webp.ts`**: RIFF `WEBP` header parser (`VP8 `, `VP8L`, `VP8X`) + lossless ARGB (`VP8L`) encoder/decoder.
   - **`gif.ts`**: GIF87a/GIF89a LZW decoder/encoder (first frame or multi-frame strip).
   - **`netpbm.ts`**: `P4` (PBM), `P5` (PGM), `P6` (PPM) reader/writer.
   - **`svg-pdf.ts`**: Delegates SVG XML and `%PDF-` byte inputs to `@poe-code/pdf-ast` at the requested `density` DPI.
3. **Resampling & Kernel Engine (`packages/image-ast/src/ops/resize.ts`)**:
   - Separable horizontal-then-vertical 1D convolution pass for `lanczos3` ($\text{sinc}(x)\text{sinc}(x/3)$) and `bilinear`, plus fast `nearest` integer lookup.
   - Premultiplied alpha resampling to prevent dark fringes on transparent PNG edges.
4. **`sips` CLI Translation Layer (`packages/safe-bash-command-sips/src/index.ts`)**:
   - Parses `sips` flags in order and translates them directly into an `ImageAstPipeline`:
     - `-g <key>` reads via `sharp(bytes).metadata()` (fast header-only parse when no pixel mutations are requested!).
     - `-r <deg>` -> `.rotate(deg)`
     - `-f horizontal|vertical` -> `.flop()` / `.flip()`
     - `-c <H> <W>` (`--cropOffset <Y> <X>`) -> `.extract({ left, top, width: W, height: H })` (defaults to centered crop when `--cropOffset` omitted, matching macOS `sips`).
     - `-Z <max>` -> `.resize(max, max, { fit: "inside" })`
     - `-z <H> <W>` -> `.resize(W, H, { fit: "fill" })`
     - `-p <H> <W>` (`--padColor <RRGGBB>`) -> `.extend({ ... })` centered to `W x H`.
     - `-s format <fmt>` & `-s formatOptions <opt>` -> `.png()` / `.jpeg({ quality })` / `.webp({ quality })`.
     - Note `sips` parameter order convention: **`sips` takes `height width` (`-z H W`, `-c H W`, `-p H W`), whereas `pixelWidth` / `pixelHeight` are named explicitly.**

## 4. Interfaces and test plan

### Module-Boundary Signatures

```ts
// packages/image-ast/src/index.ts
export interface SharpInputOptions {
  readonly density?: number;
  readonly page?: number;
  readonly limitInputPixels?: number | false;
  readonly raw?: { readonly width: number; readonly height: number; readonly channels: 1 | 2 | 3 | 4 };
  readonly create?: {
    readonly width: number;
    readonly height: number;
    readonly channels: 3 | 4;
    readonly background: string | { r: number; g: number; b: number; alpha?: number };
  };
}

export interface ImageMetadata {
  readonly format: "png" | "jpeg" | "webp" | "gif" | "ppm" | "svg" | "pdf" | "raw";
  readonly width: number;
  readonly height: number;
  readonly space: "srgb" | "b-w" | "cmyk";
  readonly channels: 1 | 2 | 3 | 4;
  readonly depth: "uchar" | "ushort" | "bit";
  readonly density: number;
  readonly hasAlpha: boolean;
  readonly orientation?: number;
}

export interface OutputInfo {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly size: number;
}

export class SharpInstance {
  metadata(): Promise<ImageMetadata>;
  metadataSync(): ImageMetadata;
  stats(): Promise<ImageStats>;
  statsSync(): ImageStats;
  resize(width?: number | null, height?: number | null, options?: ResizeOptions): this;
  extract(region: { left: number; top: number; width: number; height: number }): this;
  trim(options?: { threshold?: number }): this;
  extend(edges: { top?: number; bottom?: number; left?: number; right?: number; background?: ColorInput }): this;
  rotate(angle?: number, options?: { background?: ColorInput }): this;
  flip(flip?: boolean): this;
  flop(flop?: boolean): this;
  composite(images: CompositeLayer[]): this;
  grayscale(grayscale?: boolean): this;
  flatten(options?: { background?: ColorInput }): this;
  negate(options?: { alpha?: boolean }): this;
  modulate(options: { brightness?: number; saturation?: number; hue?: number }): this;
  blur(sigma?: number): this;
  sharpen(options?: { sigma?: number }): this;
  threshold(threshold?: number): this;
  png(options?: { compressionLevel?: number; palette?: boolean }): this;
  jpeg(options?: { quality?: number }): this;
  webp(options?: { quality?: number; lossless?: boolean }): this;
  raw(): this;
  toBuffer(): Promise<Uint8Array>;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Uint8Array; info: OutputInfo }>;
  toBufferSync(): Uint8Array;
}

export function sharp(input?: Uint8Array | SharpInputOptions, options?: SharpInputOptions): SharpInstance;
export default sharp;
```

```ts
// packages/safe-bash-command-sips/src/index.ts
export function createSipsCommand(options?: SipsCommandOptions): CommandDefinition;
export function createIdentifyCommand(options?: SipsCommandOptions): CommandDefinition;
export function sipsPlugin(options?: SipsCommandOptions): VirtualShellPlugin;
```

### Test Plan

1. **`@poe-code/image-ast` Unit Tests**:
   - `packages/image-ast/src/codecs.test.ts`: Round-trip encode/decode for PNG (RGB, RGBA, Grayscale, 16-bit), JPEG (baseline YCbCr & Grayscale at quality 50/85/100, EXIF orientation & DPI tags), WebP, GIF, PPM/PGM/PBM, plus PDF/SVG input via `@poe-code/pdf-ast`.
   - `packages/image-ast/src/pipeline.test.ts`: Tests `.resize()` (`cover`, `contain`, `fill`, `inside`, `outside`, `withoutEnlargement`), `.extract()`, `.trim()`, `.extend()`, `.rotate(0|90|180|270|45)` + auto-EXIF orient, `.flip()`/`.flop()`, `.composite()` alpha blending, `.grayscale()`, `.modulate()`, `.blur()`, `.sharpen()`, `.threshold()`, and `.stats()`.
2. **`safe-bash-command-sips` Unit & VFS Tests**:
   - `packages/safe-bash-command-sips/src/index.test.ts`:
     - Queries: `sips -g pixelWidth -g pixelHeight -g format`, `sips -g all`, `sips -1 -g pixelWidth`.
     - Mutations: `sips -Z 400`, `sips -z 300 400`, `sips -c 200 200`, `sips --cropOffset 10 20 -c 100 100`, `sips -p 500 500 --padColor FF0000`, `sips -r 90`, `sips -f horizontal`.
     - Format conversion: `sips -s format jpeg -s formatOptions 80 in.png --out out.jpg` and in-place mutation without `--out`.
     - `identify`: `identify img.png`, `identify -format "%wx%h %m" img.png`.
3. **Bundle & Declaration Verification**:
   - `npx vitest run scripts/bundle-safe-bash-private.test.ts scripts/package-safe.test.ts` ensures `@poe-code/image-ast` and `safe-bash-command-sips` bundle cleanly into `@poe-platform/safe-bash`.

### Real-World Test

1. Run unit tests across the new packages:
   ```bash
   npx vitest run packages/image-ast packages/safe-bash-command-sips
   ```
2. Build `@poe-platform/safe-bash` and run private bundle admission checks:
   ```bash
   npm run build:workspaces -- --workspace=@poe-platform/safe-bash
   npx vitest run scripts/bundle-safe-bash-private.test.ts scripts/package-safe.test.ts
   ```

### Must-Work Checklist

- [ ] `await sharp(pngBytes).resize(400, 300, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer()` outputs a valid `400x300` JPEG buffer (`\xFF\xD8\xFF...`) with PSNR > 32 dB against the source image.
- [ ] `await sharp(jpegWithExifOrientation6).rotate().metadata()` swaps width and height and normalizes pixel orientation to upright (`orientation: 1`).
- [ ] `await sharp(pdfBytes, { page: 0, density: 144 }).png().toBuffer()` rasterizes page 1 of a PDF at 2x resolution (`144 / 72`) via `@poe-code/pdf-ast`.
- [ ] `sips -g pixelWidth -g pixelHeight -g format img.png` prints the exact macOS `sips` indented property block.
- [ ] `sips -Z 500 -s format jpeg -s formatOptions 85 in.png --out out.jpg` writes a proportionally scaled JPEG whose longest edge is `500px`.
- [ ] `sips -z 300 400 in.png` resizes `in.png` in-place to `height = 300`, `width = 400` (honoring `sips`'s `height width` parameter order).
- [ ] `identify in.png` prints `<filename> PNG <width>x<height> <width>x<height>+0+0 8-bit sRGB <size>B 0.000u 0:00.000`.

## 5. Code plan

### Files to Create

- `packages/image-ast/package.json` — Private workspace package `@poe-code/image-ast` (depends on `@poe-code/pdf-ast`).
- `packages/image-ast/tsconfig.json` — TypeScript configuration.
- `packages/image-ast/src/ast.ts` — Declarative `ImageAstNode` types and color/option parsers.
- `packages/image-ast/src/codecs/png.ts` — PNG header parser, decoder, encoder, and `pHYs` DPI chunk support.
- `packages/image-ast/src/codecs/jpeg.ts` — Pure-TS JPEG DCT decoder/encoder and EXIF orientation/DPI reader.
- `packages/image-ast/src/codecs/webp.ts` — RIFF WebP header parser and VP8L lossless codec.
- `packages/image-ast/src/codecs/gif.ts` — GIF89a LZW codec.
- `packages/image-ast/src/codecs/netpbm.ts` — `P4`/`P5`/`P6` Netpbm codec.
- `packages/image-ast/src/ops/resize.ts` — Separable Lanczos-3, bilinear, and nearest-neighbor resamplers + `fit` geometry calculators.
- `packages/image-ast/src/ops/transform.ts` — `extract`, `trim`, `extend`, `rotate`, `flip`, `flop`, `composite`, `modulate`, `blur`, `sharpen`, `threshold`.
- `packages/image-ast/src/sharp.ts` — `SharpInstance` class and `sharp()` factory function.
- `packages/image-ast/src/index.ts` — Public exports for `@poe-code/image-ast`.
- `packages/image-ast/src/index.test.ts` — Codec and pipeline unit tests.
- `packages/safe-bash-command-sips/package.json` — Private command workspace `safe-bash-command-sips`.
- `packages/safe-bash-command-sips/tsconfig.json` — TypeScript configuration.
- `packages/safe-bash-command-sips/src/index.ts` — `sips` and `identify` CLI/SDK implementation (`createSipsCommand`, `createIdentifyCommand`, `sipsPlugin`).
- `packages/safe-bash-command-sips/src/index.test.ts` — Unit and VFS shell tests for `sips` and `identify`.
- `packages/safe-bash/src/commands/sips/index.ts` — Subpath export shim for `@poe-platform/safe-bash/commands/sips`.

### Files to Change

- `packages/safe-bash/package.json` — Add `./commands/sips` subpath export and `safe-bash-command-sips` workspace dependency.
- `packages/safe-bash/src/commands/index.ts` — Export `sipsPlugin`, `createSipsCommand`, and `createIdentifyCommand`.
- `packages/safe-js/package.json` (optional builtin module map) — Allow `sharp` import resolution in `safe-js` harnesses when configured.

### Build Order

1. Create `packages/image-ast` with PNG/JPEG/WebP/GIF/Netpbm codecs, resamplers, and `sharp()` API; verify with `packages/image-ast` unit tests.
2. Create `packages/safe-bash-command-sips` (`sips` + `identify`) and verify with `packages/safe-bash-command-sips` unit tests.
3. Wire `@poe-platform/safe-bash/commands/sips` into `packages/safe-bash` and run workspace build + private bundle tests.
