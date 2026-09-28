# comm

Run `comm` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { commCommands } from "@poe-platform/safe-bash/commands/comm";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(commCommands());
const result = await shell.exec("comm --help");
```

The module also exports `createCommCommand`, its command-list factory, and typed options and limits.
