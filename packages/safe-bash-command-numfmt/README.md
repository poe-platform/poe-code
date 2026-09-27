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

Resource limits are disabled by default (`Infinity`). Set `limits` on `createNumfmtCommand`, `createNumfmtCommands`, or `numfmtCommands` to bound `maxRecordBytes`, `maxWork`, `maxArguments`, `maxArgumentBytes` (total argument bytes), `maxFieldRanges`, `maxEmptyChunks` (total empty input chunks), `maxSingleChunkBytes`, `maxInputBytes`, or `maxOutputBytes` (each output stream). Finite limits must be positive safe integers. The legacy top-level `maxRecordBytes` option is also supported; `limits.maxRecordBytes` takes precedence.

```ts
import { numfmtCommands } from "safe-bash-command-numfmt";

shell.use(numfmtCommands({ limits: { maxRecordBytes: 1024 * 1024, maxWork: 16 * 1024 * 1024 } }));
```
