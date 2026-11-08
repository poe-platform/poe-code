# egrep

Run `egrep` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { egrepCommands } from "@poe-platform/safe-bash/commands/egrep";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(egrepCommands());
const result = await shell.exec("egrep --help");
```

The module also exports `createEgrepCommand`, its command-list factory, and typed options and limits.
