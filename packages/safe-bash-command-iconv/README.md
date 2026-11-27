# iconv

Run `iconv` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { iconvCommands } from "@poe-platform/safe-bash/commands/iconv";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(iconvCommands());
const result = await shell.exec("iconv --help");
```

`-c` and `//IGNORE` discard invalid or unrepresentable input while preserving valid output. If any input is discarded, the command returns status 1 even when later output succeeds.

`//TRANSLIT` transliterates unrepresentable characters. UTF-8 locales strip decomposable accents (for example, `café ü` becomes `cafe u` with `LC_ALL=C.UTF-8` and `-t ASCII//TRANSLIT`). `C`, `POSIX`, and an unset locale retain C-locale replacements. Locale selection follows `LC_ALL`, `LC_CTYPE`, then `LANG`.

The module also exports `createIconvCommand`, its command-list factory, and typed options and limits.
