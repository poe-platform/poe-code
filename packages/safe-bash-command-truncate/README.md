# truncate

Run `truncate` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { truncateCommands } from "@poe-platform/safe-bash/commands/truncate";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(truncateCommands());
const result = await shell.exec("truncate --help");
```

The module also exports `createTruncateCommand`, its command-list factory, and typed options and limits.
