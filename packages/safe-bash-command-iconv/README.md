# iconv

Run `iconv` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { iconvCommands } from "@poe-platform/safe-bash/commands/iconv";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(iconvCommands());
const result = await shell.exec("iconv --help");
```

`-c` and `//IGNORE` on the target encoding discard invalid or unrepresentable input while preserving valid output. If any input is discarded, the command returns status 1 even when later output succeeds. Source encoding suffixes such as `-f latin1//IGNORE` and `-f utf-8//TRANSLIT` are accepted and ignored, matching GNU iconv.

Supported encodings are ASCII, ISO-8859-1/2/15, Windows-1252 (CP1252), UTF-8, UTF-16/LE/BE, UTF-32/LE/BE, Shift_JIS, and EUC-JP. Use `iconv --list` for aliases. UTF-16 and UTF-32 consume an input byte-order mark and emit a little-endian byte-order mark; explicit LE/BE variants do not add or strip one.

`//TRANSLIT` transliterates unrepresentable characters. UTF-8 locales strip decomposable accents (for example, `café ü` becomes `cafe u` with `LC_ALL=C.UTF-8` and `-t ASCII//TRANSLIT`). `C`, `POSIX`, and an unset locale retain C-locale replacements. Locale selection follows `LC_ALL`, `LC_CTYPE`, then `LANG`.

The module also exports `createIconvCommand`, its command-list factory, and typed options and limits.
