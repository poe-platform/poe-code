# install

Run `install` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { installCommands } from "@poe-platform/safe-bash/commands/install";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(installCommands());
const result = await shell.exec("install --help");
```

The module also exports `createInstallCommand`, its command-list factory, and typed options and limits.
