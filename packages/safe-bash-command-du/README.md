# du

Run `du` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { duCommands } from "@poe-platform/safe-bash/commands/du";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(duCommands());
const result = await shell.exec("du --help");
```

The module also exports `createDuCommand`, its command-list factory, and typed options and limits.
