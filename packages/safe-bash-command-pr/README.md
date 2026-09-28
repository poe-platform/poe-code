# pr

Run `pr` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { prCommands } from "@poe-platform/safe-bash/commands/pr";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(prCommands());
const result = await shell.exec("pr --help");
```

The module also exports `createPrCommand`, its command-list factory, and typed options and limits.
