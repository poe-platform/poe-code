# safe-bash-command-dd

Block-oriented byte copying, slicing, and case/padding conversion over VFS.

Copy and transform byte streams with `if=`, `of=`, `bs=`, `ibs=`, `obs=`, `count=`, `skip=`, `seek=`, `conv=`, and `status=` controls.

## Features

- `if=FILE`, `of=FILE`, `bs=BYTES`, `count=N`, `skip=N`, `seek=N` — Precise binary slicing and offset writes
- `conv=lcase,ucase,swab,sync,notrunc,fsync` — In-flight byte conversions and truncation control
- `status=none|noxfer|progress` — Control transfer summary diagnostics on stderr

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("printf 'hello world' | dd bs=1 skip=6 count=5 status=none");
```

Command factories accept `limits: Partial<DdLimits>` for block size, buffer size, transferred bytes, read operations, and argument bytes. Nested limits take precedence over the corresponding top-level options. Each limit accepts `Infinity` (the default) or a positive safe integer; `maxTransferBytes` also accepts zero.
