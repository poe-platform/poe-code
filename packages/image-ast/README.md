# `@poe-code/image-ast`

Zero-dependency image processing AST and pixel pipeline with a `sharp`-compatible API for `@poe-platform/safe-bash` and `@poe-platform/safe-js`.

The main export uses Web Streams and Uint8Array in every runtime, including
Node, browsers and Workers, without Node builtins. File paths require an explicit
`filesystem` with asynchronous `readFile` and `writeFile` methods (such as safe-fs)
and an asynchronous output method; byte inputs also
support synchronous output. `@poe-code/image-ast/portable` exposes the same `sharp` API alongside codecs and
pixel operations; `compositeImage` accepts an explicit `readFile` capability.
Pixel operations also expose `...Steps` generators, such as `resizeImageSteps`,
for hosts that schedule bounded work between event-loop turns. The synchronous
functions return the same pixel results.
`decodePngToStorage(source, storage, signal)` decodes PNGs through reads and writes
of at most 4 KiB, including wide scanlines and Adam7 interlacing. Supply a
retained byte-range source and backing storage with `allocate`, `read`, and
`write`; the returned `position` addresses packed RGBA pixels in that storage.
`encodePngFromStorage(image, storage, signal)` produces bounded PNG chunks
under downstream backpressure. The caller owns source and storage cleanup.
`transformStoredImage(image, storage, operation, signal)` applies flips, crops,
right-angle rotations and EXIF orientation in small tiles, plus bounded color,
alpha, gamma, threshold, normalization and metadata operations. Canvas extension,
affine transforms, arbitrary rotation, median filtering, trimming, convolution,
Gaussian blur, sharpening, local contrast enhancement (CLAHE), dilation and erosion
also keep raster data in caller storage. For compositing, Boolean operations and channel joins, supply
a `StoredImageResources` resolver as the fifth `transformStoredImage`
argument; it returns decoded images in the same caller-owned storage. PNG file
operands and composite overlays use the parent filesystem with retained reads and version checks.
Raw operands support every sample depth in bounded chunks, and created overlays
(including deterministic Gaussian noise) generate directly into caller storage.
Composite placement, tiling and blend modes use fixed pixel caches; text and other
encoded overlay formats currently use the buffered fallback.
Combined resize/blur/sharpen/convolution stages share premultiplied alpha and gamma handling.
`resizeStoredImage(image, storage, options, signal)` supports all resize fits,
gravity, entropy/attention crops, background canvases and image pages.
PNG-to-PNG `.toFile()`
conversions with these operations and `.resize()` use the backed codecs automatically when the
supplied filesystem supports retained reads, working storage, and atomic
streaming or retained staged publication.
`resampleStoredImage(image, storage, {width, height, kernel}, signal)` resamples
backed RGBA pixels with bounded caches, including alpha and all resize kernels.
Optional explicit scales must round to the requested output dimensions.
Use an external backing provider
for large images; memory-backed storage still retains the pixels in RAM.

Input pixel limits are disabled by default; set `limitInputPixels` to a positive
integer to enforce a limit, or `Infinity` to explicitly disable it.

```ts
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

const filesystem = new MemoryFileSystem();
await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" }, filesystem })
  .png().toFile("/input.png");
await sharp("/input.png", { filesystem }).resize(16, 16).toFile("/output.png");
```

## Features

- **Zero Native Dependencies**: Pure TypeScript PNG, JPEG (baseline/progressive DCT + EXIF), WebP, iPhone HEIC / HEIF / AVIF (ISOBMFF `ftyp`/`meta`/`pitm`/`iprp`/`ipco`/`ispe`/`pixi`/`irot`/`iref`/`iloc`/`Exif`), GIF, Netpbm (`PPM`/`PGM`/`PBM`), BMP, and TIFF codecs, plus PDF and SVG rasterization via `@poe-code/pdf-ast`.
- **Declarative Operation AST**: `.rotate()`, `.resize()` (`cover`, `contain`, `fill`, `inside`, `outside` with Lanczos-3, Mitchell, bilinear, and nearest kernels), `.extract()`, `.trim()`, `.extend()`, `.composite()`, `.modulate()`, `.grayscale()`, `.blur()`, `.sharpen()`, `.threshold()`, `.metadata()`, and `.stats()`.
