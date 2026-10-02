# pr

Run `pr` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { prCommands } from "@poe-platform/safe-bash/commands/pr";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(prCommands());
const result = await shell.exec("pr --help");
```

The module also exports `createPrCommand`, its command-list factory, and typed options and limits.

Use `-t` to omit headers, `-2` for two columns, `-m` to merge input files,
and `-l`/`-w` to set page length and width. Input and output stay in the virtual
filesystem and byte streams. Supported locales are `C`, `POSIX`, `C.UTF-8` and `C.utf8`;
header dates use UTC.

Set `limits` on `prCommands` to bound columns, page width, buffered bytes,
output bytes and work, for example `{ limits: { maxColumns: 64,
maxPageWidth: 4096, maxOutputBytes: 1048576 } }`. Limits default to unbounded;
explicit bounds are admitted before layout allocation. Supply `clock` for
reproducible stdin header dates. Duplicate registration fails unless
`replace: true` is supplied.
