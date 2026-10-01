# join

Run `join` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { joinCommands } from "@poe-platform/safe-bash/commands/join";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(joinCommands());
const result = await shell.exec("join --help");
```

The module also exports `createJoinCommand`, its command-list factory, and typed options and limits.

Default order checking includes the transition into the first unpaired row, even after matching rows. This detects some unsorted inputs that GNU coreutils accepts silently. Use `--check-order` to check fully paired inputs too, or `--nocheck-order` to disable checking.
