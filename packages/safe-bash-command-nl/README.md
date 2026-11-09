# nl

Run `nl` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

Numbering styles for `-b`, `-h`, and `-f` follow GNU `nl`: values beginning with `a`, `t`, or `n` select all lines, nonempty lines, or no lines (for example, `-b all`). A value beginning with `p` uses the remaining text as a basic regular expression.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { nlCommands } from "@poe-platform/safe-bash/commands/nl";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(nlCommands());
const result = await shell.exec("nl --help");
```

The module also exports `createNlCommand`, its command-list factory, and typed options and limits.
