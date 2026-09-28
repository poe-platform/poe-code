# xan

Run `xan` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { xanCommands } from "@poe-platform/safe-bash/commands/xan";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(xanCommands());
const result = await shell.exec("xan --help");
```

The module also exports `createXanCommand`, its command-list factory, and typed options and limits.
