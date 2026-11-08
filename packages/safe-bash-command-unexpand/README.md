# unexpand

Run `unexpand` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { unexpandCommands } from "@poe-platform/safe-bash/commands/unexpand";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(unexpandCommands());
const result = await shell.exec("unexpand --help");
```

The module also exports `createUnexpandCommand`, its command-list factory, and typed options and limits.
