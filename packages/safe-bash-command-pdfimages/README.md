# `@poe-platform/safe-bash/commands/pdfimages`

Zero-dependency Poppler `pdfimages` image extractor and inspector for `@poe-platform/safe-bash` powered by `@poe-code/pdf-ast`. List and extract embedded XObject, nested Form XObject, and inline PDF images to `.png`, `.jpg`, `.ppm`, or `.pbm`.

## Features

| Option | Description |
| --- | --- |
| `-list` | Print Poppler metadata table with page, dimensions, color space, PPI, object ID, and size |
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
