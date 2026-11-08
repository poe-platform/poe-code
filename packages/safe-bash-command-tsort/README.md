# tsort

Run `tsort` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { tsortCommands } from "@poe-platform/safe-bash/commands/tsort";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(tsortCommands());
const result = await shell.exec("tsort --help");
```

The module also exports `createTsortCommand`, its command-list factory, and typed options and limits.
