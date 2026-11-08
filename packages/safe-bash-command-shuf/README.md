# safe-bash-command-shuf

Generate random permutations of input lines, argument lists, or integer ranges.

File input and output use the supplied safe-fs. The asynchronous command keeps a 1 MiB page cache and at most 4,096 entries in each of three integer-index caches; larger records, permutations, and sparse sampling state spill through retained read/write file handles. Transfers are bounded even for a single very long record. Small operations do not create temporary files.

Set `TMPDIR` in the Shell environment to choose a scratch directory within that same filesystem; otherwise Shuf uses the current virtual directory. The directory must already exist and permit exclusive file creation and conditional removal. No host temporary directory or private filesystem is used. For large Worker workloads, supply streaming reads and an external safe-fs backend with retained positioned I/O and conditional removal. Object-publication backends should also provide private staging with a bounded page budget. A memory-backed filesystem still keeps its backing data in RAM. Scratch names are conditionally removed immediately after acquisition; the retained handles and private object staging are released on completion or cancellation.

Resource limits default to `Infinity`; configure finite quotas through `limits: { maxInputBytes, maxSampleSize }` when needed. Legacy top-level options remain supported; nested limits take precedence.

Shuffle lines from files, standard input, `-e` arguments, or `-i LO-HI` numeric ranges with optional `-n COUNT`, `-r` replacement, and `--random-source` determinism. Count validation and random-source opening follow GNU coreutils 9.12: trailing count garbage is rejected, non-repeat `-n0` skips the random source, and single-record selections still open it. Explicit counts at or above UINT64_MAX are accepted; repeating empty input reports `no lines to repeat`.

## Features

- `-e` / `--echo` — Shuffle command-line arguments
- `-i LO-HI` / `--input-range=LO-HI` — Shuffle integers in inclusive range
- `-n COUNT` / `--head-count=COUNT` and `-r` / `--repeat` — Bound output length and sample with replacement
- `-z` / `--zero-terminated` and `-o FILE` — NUL-delimited records and direct file output

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("shuf -i 1-10 -n 3");
```
