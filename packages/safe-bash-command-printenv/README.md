# printenv

Run `printenv` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { printenvCommands } from "@poe-platform/safe-bash/commands/printenv";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(printenvCommands());
const result = await shell.exec("printenv --help");
```

The module also exports `createPrintenvCommand`, its command-list factory, and typed options and limits.
