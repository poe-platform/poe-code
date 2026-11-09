# tac

Run `tac` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { tacCommands } from "@poe-platform/safe-bash/commands/tac";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(tacCommands());
const result = await shell.exec("tac --help");
```

The module also exports `createTacCommand`, its command-list factory, and typed options and limits. Long options accept unambiguous abbreviations, such as `--sep=:`, `--bef`, and `--reg`. An empty literal separator (`-s ''`) splits on NUL; an empty regex separator (`-r -s ''`) fails with exit status 1. In `C.UTF-8`, regex ranges with non-ASCII endpoints fail with `Invalid collation character`, matching GNU tac on Linux; Unicode bracket literals and ASCII ranges remain valid.
