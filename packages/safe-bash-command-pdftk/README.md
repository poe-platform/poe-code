# `@poe-platform/safe-bash/commands/pdftk`

`createPdftkCommand(options?)` creates one command, `createPdftkCommands(options?)` returns the command family, and `pdftkCommands(options?)` registers it as a shell plugin. `PdftkCommandsOptions` describes configuration; all three factories accept no arguments.

Zero-dependency `pdftk` (PDF Toolkit) CLI for `@poe-platform/safe-bash` powered by `@poe-code/pdf-ast`. Assemble multi-handle page ranges, inspect and fill AcroForm fields from FDF/XFDF, flatten annotations into page content, burst documents, and apply backgrounds or stamps inside your virtual filesystem. Document, annotation and form-field inspection, FDF export and attachment extraction use retained random-access inputs and stages report output through the caller's filesystem, including stdin, encrypted inputs and atomic file publication. Document reports stream metadata, bookmarks, page geometry and labels with caller-backed traversal and deduplication. Scratch storage uses `TMPDIR`; use an external backend for large files. Attachment extraction stages decoded files before publication, preserves filename collisions and writes each destination atomically. FDF export preserves field hierarchy and duplicate-name behavior using caller-backed lookup and traversal records. Individual source COS values still require resident memory. `stamp`, `multistamp`, `background` and `multibackground` stream preserved content and caller-backed resource renames. Their `flatten` variants retain the compatibility path. `attach_files` streams compressed payloads into caller storage, preserves duplicate names, and supports page attachment annotations. `rotate` iterates page ranges and stages the final rotation per page in caller storage, preserving relative rotations and last-selection-wins behavior. Plain `output` also uses caller-backed edits and streamed serialization, including XFA/XMP removal, appearance flags, stream compression, trailer IDs and output encryption. `burst` copies and atomically publishes one page at a time through caller storage, including compression and the document report. Its `flatten` variant, `output flatten` and other editing operations retain their compatibility execution path.

## Features

| Operation | Description |
| --- | --- |
| `cat` / `shuffle` | Multi-handle page assembly (`A=a.pdf B=b.pdf cat A1-2 B1east A3-end`) |
| `dump_data` / `dump_data_utf8` / `update_info` / `update_info_utf8` | Inspect and update PDF metadata (`InfoBegin`), hierarchical bookmarks (`BookmarkBegin`), and page labels (`PageLabelBegin`) |
| `dump_data_fields` / `dump_data_fields_utf8` / `generate_fdf` | Inspect AcroForm fields (`FieldType`, `FieldName`, `FieldValue`, `FieldStateOption`) or export FDF |
| `dump_data_annots` / `dump_data_annots_utf8` | Stream annotation reports, action chains and destinations using caller-backed traversal |
| `fill_form <fdf\|xfdf>` + `flatten` | Fill AcroForm fields and bake appearances into static page content |
| `burst` | Split PDF into individual pages (`page_%04d.pdf`) and `doc_data.txt` |
| `rotate` / `background` / `multibackground` / `stamp` / `multistamp` | Page rotation and single-page or multi-page watermark/stamp composition |
| `attach_files` / `unpack_files` | Embed document-level or page-level (`to_page <n>`) file attachments and unpack embedded files |
| `input_pw` / `user_pw` / `owner_pw` / `allow` | Decrypt input PDFs and encrypt output PDFs with fine-grained permission flags |

## Quick Start

```ts
import { createShell } from "@poe-platform/safe-bash";
import { pdftkPlugin } from "@poe-platform/safe-bash/commands/pdftk";

const shell = createShell({
  plugins: [pdftkPlugin()]
});

await shell.exec("pdftk tax-form.pdf fill_form answers.fdf output filled.pdf flatten");
```

The workspace entrypoint exports `pdftkCommands()` for plugin registration,
`createPdftkCommands()` for the command collection, and
`createPdftkCommand()` for a single command. Each accepts an optional
`PdftkCommandsOptions` object; existing factory names remain available.

Configure `limits: { maxInputBytes: 16 * 1024 * 1024 }` to bound command input. `PdftkLimits` is exported for typed configuration; omitted limits default to `Infinity`. Long-running command loops yield to timers and cancellation, including Workers with frozen clocks.

Output parent directories must already exist. Only input file operands count as file reads; existing output files and filenames matching option values are not preloaded.
Embedded attachment filenames are reduced to their final path component when extracting, keeping them in the chosen output directory.
