# safe-bash-command-bzip2

Standalone `bzip2`, `bunzip2`, and `bzcat` Burrows-Wheeler block compression.

Compress, decompress, and test `.bz2` streams and VFS files with full Burrows-Wheeler Transform, Move-To-Front, and canonical Huffman coding.

## Features

- `bzip2`, `bunzip2`, `bzcat` — Compress, decompress, or stream `.bz2` payloads to stdout
- `-d` / `--decompress`, `-z` / `--compress`, `-c` / `--stdout`, `-t` / `--test` — Mode selection
- `-k` / `--keep`, `-f` / `--force`, `-1`..`-9` — File retention and block size (`100k`..`900k`) controls

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("printf 'payload' | bzip2 -c | bunzip2 -c");
```
