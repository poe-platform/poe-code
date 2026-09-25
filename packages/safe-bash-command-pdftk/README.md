# `@poe-platform/safe-bash/commands/pdftk`

Zero-dependency `pdftk` (PDF Toolkit) CLI for `@poe-platform/safe-bash` powered by `@poe-code/pdf-ast`. Assemble multi-handle page ranges, inspect and fill AcroForm fields from FDF/XFDF, flatten annotations into page content, burst documents, and apply backgrounds or stamps in memory.

## Features

| Operation | Description |
| --- | --- |
| `cat` / `shuffle` | Multi-handle page assembly (`A=a.pdf B=b.pdf cat A1-2 B1east A3-end`) |
| `dump_data` / `dump_data_utf8` / `update_info` / `update_info_utf8` | Inspect and update PDF metadata (`InfoBegin`), hierarchical bookmarks (`BookmarkBegin`), and page labels (`PageLabelBegin`) |
| `dump_data_fields` / `dump_data_fields_utf8` / `generate_fdf` | Inspect AcroForm fields (`FieldType`, `FieldName`, `FieldValue`, `FieldStateOption`) or export FDF |
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
