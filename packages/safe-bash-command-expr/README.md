# expr

Run `expr` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { exprCommands } from "@poe-platform/safe-bash/commands/expr";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(exprCommands());
const result = await shell.exec("expr --help");
```

The module also exports `createExprCommand`, its command-list factory, and typed options and limits.
