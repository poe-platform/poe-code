# comm

Run `comm` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { commCommands } from "@poe-platform/safe-bash/commands/comm";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(commCommands());
const result = await shell.exec("comm --help");
```

The module also exports `createCommCommand`, its command-list factory, and typed options and limits.

Merging and order checks use `LC_ALL`, then `LC_COLLATE`, then `LANG` (ignoring empty values). C/POSIX locales use byte order; supported language locales use runtime Unicode collation, comparing embedded NUL-separated portions in order for newline-delimited records, with byte order breaking ties between distinct records. Only byte-identical records enter the common column. Output delimiters always retain byte equality.

With `POSIXLY_CORRECT` set (including an empty value), options must precede the first file operand. Otherwise, options may follow operands. Use `--` to end option parsing explicitly.

Default order checking includes the transition into the first unpaired row, even after matching rows. This detects some unsorted inputs that GNU coreutils accepts silently. Descending rows already matched in both files do not cause an error when one file ends first. The `--output-delimiter`, `--total`, `--zero-terminated`, `--check-order`, `--nocheck-order`, `--help`, and `--version` options accept unique prefixes, such as `--out=:`, `--tot`, `--he`, and `--ver`. Use `--check-order` to check fully paired inputs too, or `--nocheck-order` to disable checking.
