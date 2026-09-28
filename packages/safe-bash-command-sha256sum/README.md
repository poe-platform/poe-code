# sha256sum

Run `sha256sum` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { sha256sumCommands } from "@poe-platform/safe-bash/commands/sha256sum";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(sha256sumCommands());
const result = await shell.exec("sha256sum --help");
```

The module also exports `createSha256sumCommand`, its command-list factory, and typed options and limits.
