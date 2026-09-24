# `@poe-platform/safe-bash/commands/pdftotext`

Extract structured, layout-preserving, raw, XHTML bounding-box, HTML metadata, or TSV text from PDF documents inside `safe-bash` virtual shells or directly from TypeScript.

## Features

| Mode / Option | CLI Flag | Description |
| --- | --- | --- |
| Logical Reading Order | *(default)* | Sorts multi-column flows, rejoins hyphenated line wraps, and emits page breaks (`\f`). |
| Physical Layout | `-layout` | Preserves multi-column horizontal alignment and baseline vertical spacing. |
| Raw Content Order | `-raw` | Emits text in PDF content-stream operator order. |
| XHTML Bounding Boxes | `-bbox` / `-bbox-layout` | Outputs `<doc>`, `<page>`, `<flow>`, `<block>`, `<line>`, and `<word>` coordinates scaled by `-r <dpi>`. |
| Poppler TSV | `-tsv` | Emits hierarchical `level`/`page_num`/`par_num`/`block_num`/`line_num`/`word_num` bounding boxes and confidences. |
| HTML Metadata | `-htmlmeta` | Wraps extracted text in an HTML document with `<meta>` tags from `/Info`. |
| Crop Area & Ranges | `-f`/`-l`, `-x`/`-y`/`-W`/`-H` | Restricts extraction to specific page ranges and rectangular crop regions. |
| Line Endings & Page Breaks | `-eol unix\|dos\|mac`, `-nopgbrk` | Controls line terminator bytes and form-feed (`\f`) output. |
| PDF to HTML / XML (`pdftohtml`) | `pdftohtml -xml` / `-s file.pdf` | Converts PDF pages into structured HTML or Poppler `pdf2xml` XML with positioned text blocks. |

## Quick Start

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { pdftotextCommands } from "@poe-platform/safe-bash/commands/pdftotext";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(pdftotextCommands());

const result = await shell.exec("pdftotext -layout /report.pdf -");
console.log(result.stdout);
```
