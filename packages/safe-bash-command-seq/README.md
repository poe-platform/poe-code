# seq

Run `seq` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs. The apostrophe format flag (`%'.0f`) groups thousands in `en_US.utf8` / `en_US.UTF-8` and leaves C/POSIX output ungrouped; numeric locale precedence is `LC_ALL`, `LC_NUMERIC`, then `LANG`.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { seqCommands } from "@poe-platform/safe-bash/commands/seq";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(seqCommands());
const result = await shell.exec("seq --help");
```

The module also exports `createSeqCommand`, its command-list factory, and typed options and limits.

Hexadecimal formats (`%a` and `%A`) follow GNU seq on x86_64 Linux/glibc: `seq -f '%.0a' 1.5 1.5` prints `0xcp-3`, preserving 1.5 at zero fractional precision.
