# `@poe-platform/safe-bash/commands/pdftoppm`

`createPdftoppmCommand(options?)` creates one command, `createPdftoppmCommands(options?)` returns the command family, and `pdftoppmCommands(options?)` registers it as a shell plugin. `PdftoppmCommandsOptions` describes configuration; all three factories accept no arguments.

Zero-dependency Poppler `pdftoppm` page renderer for `@poe-platform/safe-bash` powered by `@poe-code/pdf-ast`. Render PDF pages to PNG, JPEG, TIFF, PPM, PGM, PBM, or SVG through the supplied filesystem without native Poppler binaries.

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

The workspace entrypoint exports `pdftoppmCommands()` for plugin registration,
`createPdftoppmCommands()` for the command collection, and
`createPdftoppmCommand()` for a single command. Each accepts an optional
`PdftoppmCommandsOptions` object; existing factory names remain available.

Configure `limits: { maxInputBytes: 16 * 1024 * 1024 }` to bound command input. `PdftoppmLimits` is exported for typed configuration; omitted limits default to `Infinity`. Long-running command loops and PDF page rasterization and pixel encoding yield to timers and cancellation, including Workers with frozen clocks.

Raster output uses retained PDF reads, fixed-size pixel windows and caller-backed
staging in `TMPDIR` (default `/tmp`). All pages finish rendering before output
publication, and each file is published atomically. Use an external filesystem
backend for large documents. Decoded image pixels and resampling levels use a
64 KiB cache with caller-backed spill storage, released after each page. Other
resources and nested paint captures retain their current memory requirements. SVG, Cairo vector/PDF output, and the
buffered convenience runners still use their existing execution paths. Cairo
raster formats share the retained pipeline and preserve their output naming,
color-conversion and error conventions.

Output parent directories must already exist. Only input file operands count as file reads; existing output files and filenames matching option values are not preloaded.

Unknown options, missing option values, invalid numeric values, and extra operands return exit code `99`. Omit the input filename or use `-` to read stdin. Empty PDF input returns exit code `1`.
