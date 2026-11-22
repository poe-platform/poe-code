# Tesseract OCR

Read images and make scanned PDFs searchable using the original Tesseract engine,
implemented in Rust with asynchronous Node.js bindings. English is included;
additional languages are supplied as model bytes. No Python, subprocesses, model
downloads, or system Tesseract installation are needed at runtime.

```sh
npm install @poe-platform/tesseract
tesseract scan.png stdout
tesseract scan.png layout tsv
tesseract scan.png layout hocr
ocrmypdf scan.pdf searchable.pdf --sidecar text.txt
```

| Command | Output |
| --- | --- |
| `tesseract INPUT OUTPUTBASE [txt\|tsv\|hocr]` | Text, or block/line/word coordinates |
| `ocrmypdf INPUT.pdf OUTPUT.pdf` | Original pages with an invisible, searchable text layer |
| `ocrmypdf --skip-text INPUT.pdf OUTPUT.pdf` | Preserve pages that already contain text |

`tesseract` accepts `stdin`/`-` as input and `stdout`/`-` as output.
`ocrmypdf` uses `-` for either stream. Run each command with `--help` for options.
This focused PDF implementation supports standard PDF, sidecar text and
`--oversample DPI`; it does not support PDF/A, deskew, force-ocr or optimization.
Encrypted PDFs and nonstandard UserUnit values are rejected. Existing text causes
an error unless `--skip-text` is set. Existing text on skipped pages is included in sidecar text.

## JavaScript

```js
import { readFile, writeFile } from 'node:fs/promises';
import { recognize, recognizePdf } from '@poe-platform/tesseract';

const result = await recognize(await readFile('scan.png'));
console.log(result.text, result.tsv, result.hocr);

const searchable = await recognizePdf(await readFile('scan.pdf'), {
  skipText: true,
  maxPages: 100,
  signal: AbortSignal.timeout(30_000),
});
await writeFile('searchable.pdf', searchable.pdf);
```

Defaults bound input/model bytes to 64 MiB each, decoded pixels to 40 million,
output to 16 MiB, and processing to 30 seconds. Override these with `limits`:
`maxInputBytes`, `maxModelBytes`, `maxPixels`, `maxOutputBytes`, `timeoutMs`.
Cancellation is cooperative; native decoding and PDF parsing cannot be forcibly
interrupted. These limits are not an OS memory or process isolation boundary.

## Additional languages

Only the 4.1 MB `tessdata_fast` English model is embedded. Pass one compatible
LSTM `.traineddata` model per call, for example `chi_sim`, `chi_tra`, or `kor`:

```js
const result = await recognize(imageBytes, {
  language: 'kor',
  model: await readFile('models/kor.traineddata'),
});
```

```sh
tesseract scan.png stdout -l chi_sim --tessdata-dir ./models
ocrmypdf -l kor --tessdata-dir ./models scan.pdf searchable.pdf
```

Models come from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast).
The bundled English revision is recorded in NOTICE. Models are validated before
initialization; embedded config only permits `preserve_interword_spaces` (0 or 1).
Models requiring other embedded settings or multiple simultaneous languages are
not supported. Application code controls model acquisition and trust.

## Rust

The `poe-tesseract` crate in this repository exposes `recognize`, `Options`,
`Model`, and `Limits`. Enable its `pdf` Cargo feature for `pdf::recognize_pdf`.

```rust
let result = poe_tesseract::recognize(image_bytes, &poe_tesseract::Options::default())?;
println!("{}", result.text);
```

## SafeJS and Safe Bash

Supply OCR explicitly as a host capability in SafeJS:

```js
import { run } from '@poe-platform/safe-js';
import { recognize } from '@poe-platform/tesseract';

const result = await run(`
  import { scan } from 'ocr';
  return (await scan()).text;
`, { modules: { ocr: { scan: () => recognize(imageBytes) } } });
```

For virtual files, register `tesseractCommands()` from
`@poe-platform/safe-bash/commands/tesseract` and `ocrmypdfCommands()` from
`@poe-platform/safe-bash/commands/ocrmypdf`. Both accept `models` and `limits`.
The commands only read and write the configured virtual filesystem.

OCR is an optional peer of Safe Bash and is absent from default commands.
Importing SafeJS or Safe Bash does not install the models or native engine.
Unused OCR imports can be tree-shaken; native loading happens on the first OCR
or parser call. The OCR package itself installs one platform binary with English.
Prebuilt binaries support Node.js 22+, macOS ARM64/x64 and glibc Linux ARM64/x64
(glibc 2.39+ on ARM64, 2.35+ on x64). Browser, Workers, Windows and musl are not
supported by these native bindings.
