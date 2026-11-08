# seq

Run `seq` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { seqCommands } from "@poe-platform/safe-bash/commands/seq";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(seqCommands());
const result = await shell.exec("seq --help");
```

The module also exports `createSeqCommand`, its command-list factory, and typed options and limits.
