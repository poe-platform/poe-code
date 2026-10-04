# `@poe-platform/safe-bash/commands/qpdf`

`createQpdfCommand(options?)` creates one command, `createQpdfCommands(options?)` returns the command family, and `qpdfCommands(options?)` registers it as a shell plugin. `QpdfCommandsOptions` describes configuration; all three factories accept no arguments. `QpdfLimits` configures cumulative `maxInputBytes`, `maxOutputBytes`, and `maxArgumentBytes` through `options.limits`; omitted limits default to `Infinity`. Asynchronous execution yields between bounded work batches and honors cancellation.

Inspect, check, encrypt, decrypt, merge, split, rotate, and transform PDFs at the COS and page-tree level inside `safe-bash` virtual shells or directly from TypeScript. Use `-` as the input to read a PDF from stdin or as the output to write a PDF to stdout. `qpdf in.pdf -` leaves stdin unread; `qpdf - -` transforms stdin to stdout. `qpdf @args.txt` reads one argument per line and resolves referenced files from the shell working directory.

## Features

| Capability | CLI Flag | Description |
| --- | --- | --- |
| Structural Check | `--check` | Validates COS xref/trailer/object graph and reports version & repair status. |
| Page & Object Inspection | `--show-npages` / `--npages`, `--show-xref`, `--show-object=<n>`, `--json` | Inspects page count, xref table, individual COS objects, or QPDF v1/v2 JSON. |
| Encryption & Predicates | `--encrypt ... --`, `--decrypt`, `--show-encryption`, `--is-encrypted`, `--requires-password` | Encrypts/decrypts PDFs and evaluates encryption status codes (`0`, `2`, `3`). |
| Page Selection & Merge | `--empty --pages fileA.pdf 1-3,r1 fileB.pdf 1-5:odd -- out.pdf` | Supports `rN`/`z`, descending ranges, `x` exclusions, and `:odd`/`:even` positional filters. |
| Page Splitting | `--split-pages[=n]` | Splits multi-page PDFs into numbered single-page or N-page files. |
| Page Rotation | `--rotate=[+\|-]angle:range` | Applies relative (`+90`, `-90`) or absolute (`0`, `90`, `180`, `270`) rotation to page ranges. |
| QDF & Stream Modes | `--qdf`, `--stream-data=uncompress\|compress`, `--replace-input` | Normalizes and uncompresses/recompresses streams or updates files in-place. |

## Quick Start

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { qpdfCommands } from "@poe-platform/safe-bash/commands/qpdf";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(qpdfCommands());

await shell.exec("qpdf --empty --pages /part1.pdf 1-2 /part2.pdf z -- /merged.pdf");
```

The workspace entrypoint exports `qpdfCommands()` for plugin registration,
`createQpdfCommands()` for the command collection, and
`createQpdfCommand()` for a single command. Each accepts an optional
`QpdfCommandsOptions` object; existing factory names remain available.
`iterateQpdfPageRange(spec, pageCount)` yields selected page numbers on demand;
`parseQpdfPageRange` remains available when you need an array.

Missing output parent directories are created recursively. Attachment and raw/filtered stream output preserves binary bytes. Only input file operands count as file reads; existing output files and filenames matching option values are not preloaded.

Ordinary rewrites, `--decrypt`, and removal of info, metadata, structure, forms or
page labels use retained random-access input and caller-backed output staging,
including stdin/stdout, password-protected input and `--replace-input`. File
publication requires retained atomic staging from the injected filesystem; scratch
storage uses `TMPDIR`. Use an external backend for large files. Other transformation
options currently continue through the buffered compatibility engine.

`--check`, `--show-pages`, `--show-xref`, `--show-npages` and `--show-encryption` inspect retained inputs
through caller-backed object and page indexes, preserving repair and password
diagnostics without collecting input payloads. `--is-encrypted` and
`--requires-password` scan retained input in bounded chunks and validate supplied
passwords through caller-backed object storage. Page listings with `--with-images`
keep nested-form traversal state in caller storage.

`--show-object` emits object syntax in bounded chunks. Combine it with
`--raw-stream-data` or `--filtered-stream-data` for binary stream output. The
command stages output on caller storage before writing stdout, so an output
limit or decoding failure does not publish a partial result.
