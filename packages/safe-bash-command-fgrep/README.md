# fgrep

Run `fgrep` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { fgrepCommands } from "@poe-platform/safe-bash/commands/fgrep";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(fgrepCommands());
const result = await shell.exec("fgrep --help");
```

The module also exports `createFgrepCommand`, its command-list factory, and typed options and limits.
