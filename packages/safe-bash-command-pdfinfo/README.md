# `@poe-platform/safe-bash/commands/pdfinfo`

Inspect PDF document metadata, page geometry, boxes, encryption permissions, form fields, embedded URLs, JavaScript actions, and logical structure trees inside `safe-bash` virtual shells or directly from TypeScript.

## Features

| Capability | CLI Flag | Description |
| --- | --- | --- |
| Standard Info & Geometry | `pdfinfo file.pdf` | Extracts `Title`, `Author`, `Pages`, `Encrypted`, `Page size`, `Page rot`, `Form`, `JavaScript`, `Tagged`, `File size`, and `PDF version`. |
| Page Bounding Boxes | `-box` | Prints `MediaBox`, `CropBox`, `BleedBox`, `TrimBox`, and `ArtBox` coordinates (`%8.2f`). |
| Multi-Page Ranges | `-f <first> -l <last>` | Inspects page geometry and boxes across a specific range of pages. |
| Custom Metadata | `-custom` | Includes sorted custom `/Info` dictionary string entries. |
| Raw XMP Stream | `-meta` | Outputs the raw `/Metadata` XML packet from the document catalog. |
| Date Formatting | `-isodates` / `-rawdates` | Formats PDF dates as ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`) or raw `D:...` strings. |
| URL & Link Extraction | `-url` | Lists all `/URI` link actions and URLs across inspected pages. |
| Structure & JS Inspection | `-struct` / `-struct-text` / `-js` / `-dests` | Dumps `/StructTreeRoot`, JavaScript actions, or named destinations. |
| Encrypted PDFs | `-upw <pw>` / `-opw <pw>` | Authenticates and inspects RC4/AES-encrypted PDFs and permission flags. |
| Page Rasterization (`pdftoppm`) | `pdftoppm -png -r 150 file.pdf out` | Renders PDF pages to PNG (`-png`), PPM (`-ppm`), PGM (`-gray`), or PBM (`-mono`) with `-r`, `-scale-to`, `-f`/`-l`, and `-singlefile`. |
| Image Extraction (`pdfimages`) | `pdfimages -list` / `-png file.pdf img` | Lists embedded images or extracts them as PNG/PPM files. |
| PDF Merging (`pdfunite`) | `pdfunite a.pdf b.pdf out.pdf` | Merges multiple PDF documents into a single PDF. |
| PDF Splitting (`pdfseparate`) | `pdfseparate -f 1 -l 2 in.pdf page-%d.pdf` | Splits selected pages into individual PDF files using a `%d` pattern. |

## Quick Start

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { pdfinfoCommands } from "@poe-platform/safe-bash/commands/pdfinfo";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(pdfinfoCommands());

const result = await shell.exec("pdfinfo -box -isodates /report.pdf");
console.log(result.stdout);
```
