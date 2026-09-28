# file

Run `file` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { fileCommands } from "@poe-platform/safe-bash/commands/file";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(fileCommands());
const result = await shell.exec("file --help");
```

The module also exports `createFileCommand`, its command-list factory, and typed options and limits.
