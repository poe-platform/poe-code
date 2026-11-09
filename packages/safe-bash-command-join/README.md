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

Default order checking starts when keys differ while both files still have rows, including the transition into the first unpaired row. This detects some unsorted inputs that GNU coreutils accepts silently. Rows remaining after the other file ends do not start default checking. Use `--check-order` to check all input rows, or `--nocheck-order` to disable checking.
