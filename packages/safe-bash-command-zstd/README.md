# Zstd commands

Safe Bash includes `zstd`, `unzstd`, and `zstdcat` with binary pipelines and private
VFS file staging. The internal workspace is bundled into Safe Bash.

```ts
import { Shell, CommandRegistry } from "@poe-platform/safe-bash";
import { createZstdCommands } from "@poe-platform/safe-bash/commands/zstd";
const shell = new Shell({ commands: new CommandRegistry(createZstdCommands({
  limits: { maxDecodedBytes: 1024 * 1024 },
})) });
await shell.exec("zstd -c | zstdcat", { stdin: "hello" });
await shell.dispose();
```

Use `-c` for stdout, `-d` for decompression, `-t` for integrity checks, and
`-k`/`-f` for file retention/replacement. The existing bounded codec supports
levels 1–9, checksum and frame/window controls; unsupported capabilities fail
option validation. Files are retained by default. Decoded bytes are unlimited
unless `maxDecodedBytes` (or `limits.maxDecodedBytes`) is specified. Input budgets
and cancellation use the canonical Safe Bash runtime contracts.

`zstdCommands({ replace: true })` explicitly replaces registered aliases; default
registration rejects collisions. No host codec executable is required.
