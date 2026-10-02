# Bzip2 commands for Safe Bash

Compress and decompress byte streams and virtual files with `bzip2`, `bunzip2`,
and `bzcat`. This private workspace is bundled into Safe Bash; use its public
exports without installing the workspace separately.

- `-d` / `--decompress`, `-z` / `--compress`, `-c` / `--stdout`, `-t` / `--test`
- `-k` / `--keep`, `-f` / `--force`, `-1` through `-9` block sizes
- `-s` / `--small` reduces decoder memory and caps compression at block size two
- Concatenated streams, corruption checks, cancellation, and private VFS staging

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { bzip2Commands } from "@poe-platform/safe-bash/commands/bzip2";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(bzip2Commands({ limits: { maxDecodedBytes: 1024 * 1024 } }));
const result = await shell.exec("bzip2 -c | bunzip2 -c", { stdin: "payload" });
await shell.dispose();
```

`agentCommands()` already includes all three commands. Explicit registration
rejects collisions unless `replace: true` is supplied. The decoded-byte limit
is cumulative across operands within an invocation; its compatibility default
is unlimited. Shell input/output limits and the shared codec's memory and work
accounting remain active. File operands use the supplied filesystem, never an
implicit host process. Unsupported options return a usage error.
