# nl

Run `nl` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { nlCommands } from "@poe-platform/safe-bash/commands/nl";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(nlCommands());
const result = await shell.exec("nl --help");
```

The module also exports `createNlCommand`, its command-list factory, and typed options and limits.
