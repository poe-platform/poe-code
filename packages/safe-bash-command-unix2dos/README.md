# Unix to DOS line endings in Safe Bash

Convert virtual files and streams to CRLF with `unix2dos`. The implementation
is private and bundled into Safe Bash; no separate package installation is needed.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { unix2dosCommands } from "@poe-platform/safe-bash/commands/unix2dos";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(unix2dosCommands());
try {
  const result = await shell.exec("unix2dos", { stdin: "first\nsecond\n" });
  console.log(result.stdout); // Both lines end in CRLF.
} finally {
  await shell.dispose();
}
```

| Option | Purpose |
| --- | --- |
| `-n input output` | Convert to another virtual file |
| `-O` | Send converted file contents to stdout |
| `-b`, `-r`, `-m` | Keep, remove or add a BOM |
| `-s`, `-f` | Skip binary files or force conversion |
| `-l`, `-e` | Add newlines or a final line ending |
| `-u`, `-ul`, `-ub` | Preserve or assume UTF-16 encoding |
| `-k`, `-q`, `-i[FLAGS]` | Preserve timestamps, quiet diagnostics, inspect files |

`createUnix2dosCommand` and `createUnix2dosCommands` support direct registry
composition. `agentCommands()` already includes unix2dos; use `replace: true`
when deliberately replacing it. Existing `commands/line-endings` imports still work.

Factories and the plugin accept `limits` for arguments, input/output, buffers,
diagnostics, files, work, empty chunks, paths, depth and temporary file attempts.
Limits are unbounded by default, and explicit values must be positive safe
integers. The default chunk size is 16,384 bytes. Shell output budgets still
cover file writes. Conversion uses only the supplied VFS and cancellation signal.
Staged file publication requires stable file identity, exclusive creation,
permissions and atomic rename capabilities. The virtual byte/UTF-16 profile
supports Node, browser and workerd through Safe Bash; unsupported native flags
produce diagnostics.
