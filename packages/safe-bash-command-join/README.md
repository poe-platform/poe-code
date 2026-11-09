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

Default order checking starts after reading past the first unpaired row while both files still have rows, matching GNU coreutils. Earlier descending keys are not reported retroactively. Rows remaining after the other file ends do not start default checking. Use `--check-order` to check all input rows, or `--nocheck-order` to disable checking.
