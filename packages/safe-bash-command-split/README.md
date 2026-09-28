# split

Run `split` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { splitCommands } from "@poe-platform/safe-bash/commands/split";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(splitCommands());
const result = await shell.exec("split --help");
```

The module also exports `createSplitCommand`, its command-list factory, and typed options and limits.
