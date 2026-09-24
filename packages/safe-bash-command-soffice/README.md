# `@poe-platform/safe-bash/commands/soffice`

Headless LibreOffice (`soffice` / `libreoffice`) conversion command for `safe-bash` virtual shells and TypeScript, rendering `.docx`, `.xlsx`, `.pptx`, `.csv`, `.html`, `.md`, and `.txt` documents to styled multi-page PDFs (and converting spreadsheets/documents to `.csv`, `.txt`, `.html`, `.md`) via `@poe-code/pdf-ast`.

## Features

| Conversion Route | Filter / CLI Example | Description |
| --- | --- | --- |
| Writer -> PDF | `soffice --headless --convert-to pdf:writer_pdf_Export report.docx` | Renders DOCX/HTML/Markdown/TXT headings, paragraphs, lists, and tables into paginated PDFs. |
| Calc -> PDF | `soffice --headless --convert-to pdf:calc_pdf_Export finance.xlsx` | Renders XLSX/CSV worksheets into grid-bordered tabular PDFs with shaded headers. |
| Impress -> PDF | `soffice --headless --convert-to pdf:impress_pdf_Export deck.pptx` | Renders PPTX slides into landscape 16:9 widescreen PDFs. |
| Calc -> CSV (StarCalc) | `soffice --headless --convert-to "csv:Text - txt - csv (StarCalc):59,34,76,1" book.xlsx` | Exports worksheets to CSV with configurable field separator, quote character, and BOM/encoding. |
| PDF -> DOCX / XLSX / CSV / HTML / PNG / TXT | `soffice --headless --convert-to docx document.pdf` | Converts PDFs into DOCX, XLSX, CSV, HTML, PNG, or TXT and supports `soffice --cat` / `libreoffice` alias. |

## Quick Start

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { sofficeCommands } from "@poe-platform/safe-bash/commands/soffice";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(sofficeCommands());

await shell.exec("soffice --headless --convert-to pdf --outdir /out /report.docx");
```
