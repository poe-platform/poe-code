# timeout

Run `timeout` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { timeoutCommands } from "@poe-platform/safe-bash/commands/timeout";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(timeoutCommands());
const result = await shell.exec("timeout --help");
```

The module also exports `createTimeoutCommand`, its command-list factory, and typed options and limits.
