# getopt

Run `getopt` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { getoptCommands } from "@poe-platform/safe-bash/commands/getopt";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(getoptCommands());
const result = await shell.exec("getopt --help");
```

The module also exports `createGetoptCommand`, its command-list factory, and typed options and limits.
