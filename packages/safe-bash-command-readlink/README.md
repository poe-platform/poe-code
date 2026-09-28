# readlink

Run `readlink` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { readlinkCommands } from "@poe-platform/safe-bash/commands/readlink";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(readlinkCommands());
const result = await shell.exec("readlink --help");
```

The module also exports `createReadlinkCommand`, its command-list factory, and typed options and limits.
