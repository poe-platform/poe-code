# `@poe-platform/safe-bash/commands/pdftotext`

`createPdftotextCommand(options?)` creates one command, `createPdftotextCommands(options?)` returns the command family, and `pdftotextCommands(options?)` registers it as a shell plugin. `PdftotextCommandsOptions` describes configuration; all three factories accept no arguments.

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

The workspace entrypoint exports `pdftotextCommands()` for plugin registration,
`createPdftotextCommands()` for the command collection, and
`createPdftotextCommand()` for a single command. Each accepts an optional
`PdftotextCommandsOptions` object; existing factory names remain available.

Configure `limits: { maxInputBytes: 16 * 1024 * 1024 }` to bound command input. `PdftotextLimits` is exported for typed configuration; omitted limits default to `Infinity`. Long-running command loops yield to timers and cancellation, including Workers with frozen clocks.

The `pdftotext -enc Latin1` option writes ISO-8859-1 bytes; `-enc UCS-2` writes big-endian 16-bit code units with a BOM. File output and stdout use the same encoding.

`pdftohtml` writes image files beside the output HTML or XML file, with relative image references. Stdout output (`-stdout` or `-`) creates no image files; use `-dataurls` to embed the images.

Output parent directories must already exist. Only input file operands count as file reads; existing output files and filenames matching option values are not preloaded.
