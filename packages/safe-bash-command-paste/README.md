# paste

Run `paste` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs. GNU-style unique prefixes are accepted for `--serial`, `--delimiters`, `--zero-terminated`, `--help`, and `--version`, including attached delimiter values such as `--delim=:`. When delimiter options repeat, only the final list is used and validated; every option still requires an argument.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { pasteCommands } from "@poe-platform/safe-bash/commands/paste";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(pasteCommands());
const result = await shell.exec("paste --help");
```

With `POSIXLY_CORRECT` set, options must precede the first filename or `-` operand. `--` explicitly ends option parsing in either mode. If an input read fails, paste preserves the records already read, including a final partial record and its terminator, and reports the error with exit status 1.

Delimiter cycling uses `LC_ALL`, then `LC_CTYPE`, then `LANG` (skipping empty values). With no locale set, `C`, or `POSIX`, delimiters cycle byte by byte; single-byte locales such as ISO-8859-1 also cycle bytes, while UTF-8 and multibyte locales such as EUC-JP keep each encoded character together. Invalid or incomplete delimiter bytes are preserved individually. If any effective locale category is invalid or unsupported, all categories fall back to `C` and delimiters cycle byte by byte. A nonempty `LC_ALL` overrides the other category settings.

The module also exports `createPasteCommand`, its command-list factory, and typed options and limits.
