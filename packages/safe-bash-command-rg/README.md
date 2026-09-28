# rg

Run `rg` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { rgCommands } from "@poe-platform/safe-bash/commands/rg";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(rgCommands());
const result = await shell.exec("rg --help");
```

The module also exports `createRgCommand`, its command-list factory, and typed options and limits.
