# `@poe-code/image-ast`

Zero-dependency image processing AST and pixel pipeline with a `sharp`-compatible API for `@poe-platform/safe-bash` and `@poe-platform/safe-js`.

## Features

- **Zero Native Dependencies**: Pure TypeScript PNG, JPEG (baseline/progressive DCT + EXIF), WebP, iPhone HEIC / HEIF / AVIF (ISOBMFF `ftyp`/`meta`/`pitm`/`iprp`/`ipco`/`ispe`/`pixi`/`irot`/`iref`/`iloc`/`Exif`), GIF, Netpbm (`PPM`/`PGM`/`PBM`), BMP, and TIFF codecs, plus PDF and SVG rasterization via `@poe-code/pdf-ast`.
- **Declarative Operation AST**: `.rotate()`, `.resize()` (`cover`, `contain`, `fill`, `inside`, `outside` with Lanczos-3, Mitchell, bilinear, and nearest kernels), `.extract()`, `.trim()`, `.extend()`, `.composite()`, `.modulate()`, `.grayscale()`, `.blur()`, `.sharpen()`, `.threshold()`, `.metadata()`, and `.stats()`.
