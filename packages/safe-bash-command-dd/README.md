# safe-bash-command-dd

Block-oriented byte copying, slicing, and case/padding conversion over VFS.

Copy and transform byte streams with `if=`, `of=`, `bs=`, `ibs=`, `obs=`, `count=`, `skip=`, `seek=`, `conv=`, and `status=` controls.

## Features

- `if=FILE`, `of=FILE`, `bs=BYTES`, `count=N`, `skip=N`, `seek=N` — Precise binary slicing and offset writes
- `conv=lcase,ucase,swab,sync,notrunc,fsync` — In-flight byte conversions and truncation control
- `status=none|noxfer|progress` — Control transfer summary diagnostics on stderr

## Quick Start

```ts
import { createMemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { ddCommands } from "@poe-platform/safe-bash/dd";

const fs = createMemoryFileSystem();
await fs.writeFile("/input", new TextEncoder().encode("hello world"));
const shell = new Shell({ fs }).use(ddCommands());
const res = await shell.exec("dd if=/input bs=1 skip=6 count=5 status=none");
console.log(res.stdout); // world
await shell.dispose();
```

Command factories accept `limits: Partial<DdLimits>` for block size, buffer size, transferred bytes, read operations, and argument bytes. Nested limits take precedence over the corresponding top-level options. Each limit accepts `Infinity` (the default) or a positive safe integer; `maxTransferBytes` also accepts zero.
