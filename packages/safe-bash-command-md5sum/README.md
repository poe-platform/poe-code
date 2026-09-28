# md5sum

Run `md5sum` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { md5sumCommands } from "@poe-platform/safe-bash/commands/md5sum";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(md5sumCommands());
const result = await shell.exec("md5sum --help");
```

The module also exports `createMd5sumCommand`, its command-list factory, and typed options and limits.
