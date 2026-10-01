# column

Run `column` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { columnCommands } from "@poe-platform/safe-bash/commands/column";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(columnCommands());
const result = await shell.exec("column --help");
```

`column -t` preserves UTF-8 format characters, including emoji joiners and a leading BOM, without counting them toward column width.

The module also exports `createColumnCommand`, its command-list factory, and typed options and limits.
