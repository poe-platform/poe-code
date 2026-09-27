# `@poe-code/image-ast`

Zero-dependency image processing AST and pixel pipeline with a `sharp`-compatible API for `@poe-platform/safe-bash` and `@poe-platform/safe-js`.

The main export selects a Web Streams Sharp API in browsers and Workers without
Node builtins. Node retains its Duplex stream API. File paths require an explicit
`filesystem` from safe-fs and an asynchronous output method; byte inputs also
support synchronous output. `@poe-code/image-ast/portable` exposes codecs and
pixel operations; `compositeImage` accepts an explicit `readFile` capability.

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
