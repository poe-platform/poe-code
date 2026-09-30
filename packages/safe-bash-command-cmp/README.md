# cmp

Run `cmp` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { cmpCommands } from "@poe-platform/safe-bash/commands/cmp";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(cmpCommands());
const result = await shell.exec("cmp --help");
```

The module also exports `createCmpCommand`, its command-list factory, and typed options and limits.

The opt-in factories preserve the GNU diffutils 3.12 comparison-block profile. The default shell registration retains its existing diagnostics and cumulative difference status. Both use the same input and comparison engine.
