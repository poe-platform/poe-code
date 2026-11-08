# realpath

Run `realpath` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { realpathCommands } from "@poe-platform/safe-bash/commands/realpath";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(realpathCommands());
const result = await shell.exec("realpath --help");
```

The module also exports `createRealpathCommand`, its command-list factory, and typed options and limits.
