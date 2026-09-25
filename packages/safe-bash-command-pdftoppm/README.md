# `@poe-platform/safe-bash/commands/pdftoppm`

Zero-dependency Poppler `pdftoppm` page renderer for `@poe-platform/safe-bash` powered by `@poe-code/pdf-ast`. Render PDF pages to PNG, PPM, PGM, PBM, or SVG inside the in-memory virtual filesystem without native Poppler binaries.

## Features

| Option | Description |
| --- | --- |
| `-png` / `-jpeg` / `-gray` / `-mono` / `-svg` | Output format selection (`.png`, `.jpg`, `.pgm`, `.pbm`, `.svg`, or `.ppm` default) |
| `-r <dpi>` / `-rx <dpi>` / `-ry <dpi>` | Configurable horizontal and vertical resolution (default `150` DPI) |
| `-scale-to` / `-scale-to-x` / `-scale-to-y` | Scale pages to exact target pixel dimensions (supports `-1` proportional aspect-ratio scaling) |
| `-f <page>` / `-l <page>` / `-o` / `-e` | First/last page range and odd/even page filtering |
| `-singlefile` / `-forcenum` / `-sep <char>` | Output single page without numeric suffix, force page number suffix, or customize separator |
| `-x` / `-y` / `-W` / `-H` / `-sz` / `-cropbox` | Pixel-level sub-region cropping and `/CropBox` bounding |
| `-upw <pw>` / `-opw <pw>` | Decrypt password-protected PDFs (`R2`–`R6` AES/RC4) |

## Quick Start

```ts
import { createShell } from "@poe-platform/safe-bash";
import { pdftoppmPlugin } from "@poe-platform/safe-bash/commands/pdftoppm";

const shell = createShell({
  plugins: [pdftoppmPlugin()]
});

await shell.exec("pdftoppm -png -r 150 deck.pdf slide");
```
