# `@poe-platform/safe-bash/commands/pdfimages`

Zero-dependency Poppler `pdfimages` image extractor and inspector for `@poe-platform/safe-bash` powered by `@poe-code/pdf-ast`. List and extract embedded XObject, nested Form XObject, and inline PDF images to `.png`, `.jpg`, `.ppm`, or `.pbm`.

## Features

| Option | Description |
| --- | --- |
| `-list` | Print Poppler metadata table with page, dimensions, color space, PPI, object ID, and size |
| `-min-width <pixels>` / `-min-height <pixels>` | Skip smaller images when listing or extracting |
| `-png` | Extract embedded images as `.png` files matching original pixel dimensions |
| `-j` / `-all` | Extract DCTDecode streams directly as `.jpg` |
| `-p` | Include 3-digit zero-padded page numbers in output filenames (`root-001-000.png`) |
| `-f <page>` / `-l <page>` | Filter extraction or listing to a specific page range |
| `-upw <pw>` / `-opw <pw>` | Decrypt password-protected PDFs before listing or extracting images |

## Quick Start

```ts
import { createShell } from "@poe-platform/safe-bash";
import { pdfimagesPlugin } from "@poe-platform/safe-bash/commands/pdfimages";

const shell = createShell({
  plugins: [pdfimagesPlugin()]
});

await shell.exec("pdfimages -list paper.pdf");
await shell.exec("pdfimages -png paper.pdf fig");
```

The workspace entrypoint exports `pdfimagesCommands()` for plugin registration,
`createPdfimagesCommands()` for the command collection, and
`createPdfimagesCommand()` for a single command. Each accepts an optional
`PdfimagesCommandsOptions` object; existing factory names remain available.

Configure `limits: { maxInputBytes: 16 * 1024 * 1024 }` to bound command input. `PdfimagesLimits` is exported for typed configuration; omitted limits default to `Infinity`. Long-running command loops and PDF page traversal and image decoding yield to timers and cancellation, including Workers with frozen clocks.

Output parent directories must already exist. Only input file operands count as file reads; existing output files and filenames matching option values are not preloaded.

Unknown options, missing option values, invalid numeric values, and extra operands return exit code `99`. Extraction requires an image root; `-list` accepts only the PDF filename. Use `-` as the PDF filename to read stdin. Empty PDF input returns exit code `1`.
