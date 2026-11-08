# touch

Run `touch` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { touchCommands } from "@poe-platform/safe-bash/commands/touch";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(touchCommands());
const result = await shell.exec("touch --help");
```

The module also exports `createTouchCommand`, its command-list factory, and typed options and limits.
