# `@poe-platform/safe-bash/commands/soffice`

`createSofficeCommand(options?)` creates one command, `createSofficeCommands(options?)` returns the command family, and `sofficeCommands(options?)` registers it as a shell plugin. `SofficeCommandsOptions` describes configuration; all three factories accept no arguments. `SofficeLimits` configures cumulative `maxInputBytes`, `maxOutputBytes`, and `maxArgumentBytes` through `options.limits`; omitted limits default to `Infinity`. Asynchronous execution yields between bounded work batches and honors cancellation.

Headless LibreOffice (`soffice` / `libreoffice`) conversion command for `safe-bash` virtual shells and TypeScript, rendering `.docx`, `.odt`, `.ods`, `.odp`, `.xlsx`, `.pptx`, `.csv`, `.html`, `.md`, and `.txt` documents to styled multi-page PDFs (and converting spreadsheets to `.xlsx`, `.csv`, `.txt`, `.html`, and documents to `.txt`, `.html`, `.md`) via `@poe-code/pdf-ast`.

## Features

| Conversion Route | Filter / CLI Example | Description |
| --- | --- | --- |
| Writer -> PDF | `soffice --headless --convert-to pdf:writer_pdf_Export report.docx` | Renders DOCX/HTML/Markdown/TXT headings, paragraphs, lists, and tables into paginated PDFs. |
| Calc -> PDF | `soffice --headless --convert-to pdf:calc_pdf_Export finance.xlsx` | Renders XLSX/CSV worksheets into grid-bordered tabular PDFs with shaded headers. |
| Impress -> PDF | `soffice --headless --convert-to pdf:impress_pdf_Export deck.pptx` | Renders PPTX slides into landscape 16:9 widescreen PDFs. |
| Calc -> CSV (StarCalc) | `soffice --headless --convert-to "csv:Text - txt - csv (StarCalc):59,34,76,1" book.xlsx` | Exports XLSX/ODS worksheets to CSV with configurable field separator, quote character, and quoting. |
| PDF -> DOCX / XLSX / CSV / HTML / PNG / TXT | `soffice --headless --convert-to docx document.pdf` | Converts PDFs into DOCX, XLSX, CSV, HTML, PNG, or TXT and supports `soffice --cat` / `libreoffice` alias. |

HTML/HTM inputs parse headings, paragraphs, lists, and tables and decode HTML entities
for TXT, PDF, DOCX, and `--cat` output. Scripts, styles, and document metadata are omitted.
TXT and Markdown inputs also produce valid DOCX archives; CSV and XLSX inputs produce DOCX tables.
Tabular text (comma- or tab-separated), Markdown pipe tables, and HTML/HTM tables
export to real XLSX workbooks or CSV with StarCalc filter options. Markdown alignment
rows and prose outside tables are omitted; multiple tables are concatenated in source
order into one worksheet. HTML without tables exports visible blocks as one column.

RTF input omits nested metadata groups and preserves paragraph breaks, line breaks, tabs, and escaped text. `--cat` keeps group state and trimmed paragraphs in caller backing, including arbitrarily long paragraphs and deep nested groups.

CSV input preserves quoted commas, escaped quotes, and embedded newlines. ODS-to-XLSX conversion preserves typed cells, sheet names and column positions; ODS-to-CSV exports the active worksheet and preserves explicit line breaks. These routes use the shared spreadsheet engine and independently selectable format modules. `-convert-to` and `-outdir` are accepted alongside their double-dash forms, including `=value`. Compatibility options `--infilter`, `--pidfile`, and `--language` consume their values but do not configure conversion. PPTX and ODP presentations also export to HTML and DOCX with headings and paragraphs. `--cat` extracts readable text from XLSX and PPTX archives; CSV remains source text. Malformed ZIP inputs return an error diagnostic.

## Quick Start

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { sofficeCommands } from "@poe-platform/safe-bash/commands/soffice";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(sofficeCommands());

await shell.exec("soffice --headless --convert-to pdf --outdir /out /report.docx");
```

The workspace entrypoint exports `sofficeCommands()` for plugin registration,
`createSofficeCommands()` for the command collection, and
`createSofficeCommand()` for a single command. Each accepts an optional
`SofficeCommandsOptions` object; existing factory names remain available.

`runSofficeFileCli(args, { filesystem, stdout, stderr, cwd, signal, limits })`
shares the command's file authority, budgets and output lifecycle. Plain-text and RTF `--cat`
(including CSV and Markdown source text) snapshots inputs in caller-backed storage,
then streams UTF-8 output with backpressure. It admits cumulative input/output limits
before publishing stdout and cleans up backing on cancellation or sink failure.
Plain-text and Markdown HTML/DOCX/PDF output, Markdown-to-text, plain-text copies, and
RTF-to-text/HTML/DOCX/PDF conversion also retain intermediates in caller
storage and publish output through guarded staging. Existing file identity, hard links,
symlinks and permissions are preserved. Later input operands can reuse earlier generated
outputs. Text PDF conversion retains word wrapping and page content in caller storage,
including page-range and PDF-version filters. Large inputs require an external safe-fs backend; other conversion routes and
filesystems without the required retained capabilities still use buffered adapters.

For direct TypeScript conversion, use `await runSofficeCli(args, files, cwd,
{ signal })`. Failed ODS conversion preserves an existing destination. The
synchronous helper retains its synchronous routes and reports an error for
ODS-to-CSV/XLSX conversion; use the async API for those formats.

Source paths and `--outdir` resolve relative to the working directory, including
`.` and `..`. Shell commands charge each loaded source once to the cumulative
input budget; option values and existing destinations do not count as inputs.

Use `--` before filenames beginning with a dash, for example
`soffice --convert-to txt -- -report.csv`. All following arguments are input paths.
