# readlink

Run `readlink` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { readlinkCommands } from "@poe-platform/safe-bash/commands/readlink";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(readlinkCommands());
const result = await shell.exec("readlink --help");
```

The module also exports `createReadlinkCommand`, its command-list factory, and typed options and limits. When `POSIXLY_CORRECT` is set, options must precede the first file operand; otherwise options may follow operands. Use `--` to end option parsing explicitly.

Failed operands are silent by default. Use `-v` (`--verbose`) to report them; `-q` (`--quiet`) and `-s` (`--silent`) suppress them, with the last option taking precedence. Setting `POSIXLY_CORRECT` (even to an empty value) always reports operand errors, including with `-q` or `-s`, matching GNU coreutils 9.10. Failed operands return exit status 1 in either mode.
