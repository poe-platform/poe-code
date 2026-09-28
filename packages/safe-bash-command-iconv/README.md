# iconv

Run `iconv` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { iconvCommands } from "@poe-platform/safe-bash/commands/iconv";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(iconvCommands());
const result = await shell.exec("iconv --help");
```

The module also exports `createIconvCommand`, its command-list factory, and typed options and limits.
