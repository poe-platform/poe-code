# tree

Run `tree` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { treeCommands } from "@poe-platform/safe-bash/commands/tree";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(treeCommands());
const result = await shell.exec("tree --help");
```

The module also exports `createTreeCommand`, its command-list factory, and typed options and limits.
