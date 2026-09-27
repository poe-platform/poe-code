# safe-bash-command-shuf

Generate random permutations of input lines, argument lists, or integer ranges.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Shuffle lines from files, standard input, `-e` arguments, or `-i LO-HI` numeric ranges with optional `-n COUNT`, `-r` replacement, and `--random-source` determinism.

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
