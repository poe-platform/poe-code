# `@poe-platform/safe-bash/commands/qpdf`

Inspect, check, encrypt, decrypt, merge, split, rotate, and transform PDFs at the COS and page-tree level inside `safe-bash` virtual shells or directly from TypeScript.

## Features

| Capability | CLI Flag | Description |
| --- | --- | --- |
| Structural Check | `--check` | Validates COS xref/trailer/object graph and reports version & repair status. |
| Page & Object Inspection | `--show-npages`, `--show-xref`, `--show-object=<n>`, `--json` | Inspects page count, xref table, individual COS objects, or QPDF v1/v2 JSON. |
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
