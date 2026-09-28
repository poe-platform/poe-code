# DOS and Unix line endings in Safe Bash

Convert line endings in virtual files, streams and shell scripts with `dos2unix`
and `unix2dos`. Both commands share encoding detection and staged file handling.
This private implementation is included in Safe Bash; use its public exports.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { lineEndingCommands } from "@poe-platform/safe-bash/commands/line-endings";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(lineEndingCommands());
try {
  const result = await shell.exec("dos2unix | unix2dos", { stdin: "first\r\nsecond\n" });
  console.log(result.stdout); // Both lines now end in CRLF.
} finally {
  await shell.dispose();
}
```

| Command or option | Use |
| --- | --- |
| `dos2unix` / `unix2dos` | Convert stdin, or named VFS files in place |
| `-n input output` | Convert into another VFS file |
| `-O` | Write converted file contents to stdout |
| `-b`, `-r`, `-m` | Keep, remove or add a byte order mark |
| `-u`, `-ul`, `-ub` | Preserve UTF-16, or assume little/big endian UTF-16 |
| `-s`, `-f` | Skip binary files by default, or force conversion |
| `-k`, `-q`, `-i[FLAGS]` | Preserve dates, suppress diagnostics, inspect files |

The public factories `createDos2unixCommand`, `createUnix2dosCommand` and
`createDos2unixCommands` also support direct registry composition. The collection
and plugin are available as `createLineEndingCommands` / `lineEndingCommands` and
`createDos2unixCommands` / `dos2unixCommands`. These
commands are already included by `agentCommands()`; explicit registration uses
the same collision policy and requires `replace: true` to replace existing names.

Pass `limits` to the factories or plugin to bound arguments, input, output,
buffers, diagnostics, files, work, empty chunks, path bytes, depth and temporary
file attempts. Explicit limits must be positive safe integers. Limits remain
unbounded by default; `chunkSize` defaults to 16,384 bytes. Shell budgets continue
to apply to file writes as well as stdout.

The existing virtual byte/UTF-16 profile preserves high input bytes, BOM handling,
metadata checks, cancellation and staged publication. File mutation requires the
filesystem's atomic rename, exclusive creation, permissions and stable identity
capabilities. It accesses only the supplied VFS. Unsupported flags produce a
diagnostic; this profile does not claim every native dos2unix option.
