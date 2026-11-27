# env

Run `env` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { envCommands } from "@poe-platform/safe-bash/commands/env";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(envCommands());
const result = await shell.exec("env --help");
```

New variables are appended in assignment order, matching GNU/Linux `env`. Replacing an existing value keeps its position, including when the environment is passed to a child command.

The module also exports `createEnvCommand`, its command-list factory, and typed options and limits.
