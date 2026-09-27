# safe-bash-command-nproc

Query available logical processing units for parallel build scripts.

Report deterministic processor counts with `--all`, `--ignore=N`, and `OMP_NUM_THREADS` / `OMP_THREAD_LIMIT` awareness.

## Features

- `nproc` — Print available processing units
- `--all` — Report total installed processors
- `--ignore=N` — Subtract `N` units (minimum 1) for worker pool sizing

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("nproc --ignore=1");
```
