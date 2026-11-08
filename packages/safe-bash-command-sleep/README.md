# sleep

Run `sleep` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { sleepCommands } from "@poe-platform/safe-bash/commands/sleep";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(sleepCommands());
const result = await shell.exec("sleep --help");
```

The module also exports `createSleepCommand`, its command-list factory, and typed options and limits.
