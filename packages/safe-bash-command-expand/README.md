# expand

Run `expand` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { expandCommands } from "@poe-platform/safe-bash/commands/expand";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(expandCommands());
const result = await shell.exec("expand --help");
```

The module also exports `createExpandCommand`, its command-list factory, and typed options and limits.
