# csplit

Run `csplit` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { csplitCommands } from "@poe-platform/safe-bash/commands/csplit";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(csplitCommands());
const result = await shell.exec("csplit --help");
```

The module also exports `createCsplitCommand`, its command-list factory, and typed options and limits.
