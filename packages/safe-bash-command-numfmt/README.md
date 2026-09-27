# safe-bash-command-numfmt

Convert numbers between raw integers and human-readable IEC/SI scales.
Input chunk size is unlimited by default; individual records retain their 1 MiB limit.

Reformat numbers from arguments or tabular streams using `--from`, `--to`, `--padding`, `--format`, `--round`, `--field`, and `--header`.

## Features

- `--from=UNIT` / `--to=UNIT` — Convert between `none`, `auto`, `si`, `iec`, and `iec-i` (`KiB`, `MiB`, `GiB`)
- `--field=FIELDS` & `--delimiter=CHAR` — Transform specific columns in tabular pipelines
- `--round=up|down|from-zero|towards-zero|nearest` — Precision rounding control

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("numfmt --to=iec-i 1048576"); // "1.0Mi\n"
```
