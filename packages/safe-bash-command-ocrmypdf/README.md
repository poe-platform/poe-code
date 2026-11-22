# Searchable PDFs for Safe Bash

Add searchable text to scanned PDF pages in the virtual filesystem.
Build and link the private `@poe-platform/tesseract` workspace, then register the
optional plugin. The OCR binding is not published separately to npm:

```js
import { ocrmypdfCommands } from '@poe-platform/safe-bash/commands/ocrmypdf';
shell.use(ocrmypdfCommands());
await shell.exec('ocrmypdf scan.pdf searchable.pdf --sidecar text.txt');
```

English is included. Pass `models: { kor: modelBytes }` to use `-l kor`.
`--skip-text` preserves pages that already contain text; otherwise they cause an
error. `limits` bounds bytes, pixels, pages and processing time. Standard PDF
output only; no PDF/A, deskew or force-ocr. Node.js only. See the
[OCR package](../tesseract-rust/README.md) for supported options and platforms.
