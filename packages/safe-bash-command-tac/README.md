# tac

Run `tac` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { tacCommands } from "@poe-platform/safe-bash/commands/tac";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(tacCommands());
const result = await shell.exec("tac --help");
```

The module also exports `createTacCommand`, its command-list factory, and typed options and limits.
