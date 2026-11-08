# sha1sum

Run `sha1sum` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { sha1sumCommands } from "@poe-platform/safe-bash/commands/sha1sum";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(sha1sumCommands());
const result = await shell.exec("sha1sum --help");
```

The module also exports `createSha1sumCommand`, its command-list factory, and typed options and limits.
