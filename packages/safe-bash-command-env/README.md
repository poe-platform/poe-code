# env

Run `env` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { envCommands } from "@poe-platform/safe-bash/commands/env";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(envCommands());
const result = await shell.exec("env --help");
```

The module also exports `createEnvCommand`, its command-list factory, and typed options and limits.
