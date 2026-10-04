# pdfunite

Merge PDF documents in input order, retaining page dimensions, rotation, content, fonts, images, and annotations.

Available through `@poe-platform/safe-bash/commands/pdfunite`:

```ts
import { pdfuniteCommands } from "@poe-platform/safe-bash/commands/pdfunite";
shell.use(pdfuniteCommands());
await shell.exec("pdfunite first.pdf second.pdf combined.pdf");
```

Supports `-v`, `-h`, `-help`, and `--help`. At least two input files and a destination are required. Encrypted inputs are rejected.

Factories: `createPdfuniteCommand`, `createPdfuniteCommands`. Options accept `replace` and `limits`: `maxInputBytes` (64 MiB), `maxOutputBytes` (128 MiB), `maxPages` (10,000), and `maxObjects` (100,000 per input). Inputs open sequentially through retained range reads. Merge records and output staging use the shell filesystem, and output is published atomically in bounded chunks. Metadata, flattened outlines, page labels and embedded attachments are preserved (the first attachment of each name wins). Scratch storage uses `TMPDIR` or `/tmp`; provide external filesystem backing for large Worker jobs. The PDF engine is `@poe-code/pdf-ast`.
