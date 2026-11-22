# Tesseract for Safe Bash

Recognize image text and block, line and word positions from virtual files.
Build and link the private `@poe-platform/tesseract` workspace, then register the
optional plugin. The OCR binding is not published separately to npm:

```js
import { tesseractCommands } from '@poe-platform/safe-bash/commands/tesseract';
shell.use(tesseractCommands());
await shell.exec('tesseract scan.png stdout');
await shell.exec('tesseract scan.png layout tsv');
```

English is bundled. Inject additional models with
`tesseractCommands({ models: { kor: modelBytes } })`, then use `-l kor`.
`--tessdata-dir` reads `.traineddata` files from the virtual filesystem.
`limits` bounds input/model/output bytes, pixels and processing time. Node.js only;
see the [OCR package](../tesseract-rust/README.md) for formats and platform support.
