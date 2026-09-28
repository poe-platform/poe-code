# date

Run `date` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { dateCommands } from "@poe-platform/safe-bash/commands/date";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(dateCommands());
const result = await shell.exec("date --help");
```

The module also exports `createDateCommand`, its command-list factory, and typed options and limits.
