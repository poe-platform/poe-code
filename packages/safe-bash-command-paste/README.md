# paste

Run `paste` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs. GNU-style unique prefixes are accepted for `--serial`, `--delimiters`, `--zero-terminated`, `--help`, and `--version`, including attached delimiter values such as `--delim=:`. When delimiter options repeat, only the final list is used and validated; every option still requires an argument. Invalid options, missing delimiter arguments, and unexpected arguments to flags report GNU-style diagnostics with a `paste --help` hint and exit status 1. A final delimiter list ending in an unescaped backslash is rejected with the offending list in the diagnostic, without a help hint.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { pasteCommands } from "@poe-platform/safe-bash/commands/paste";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(pasteCommands());
const result = await shell.exec("paste --help");
```

With `POSIXLY_CORRECT` set, options must precede the first filename or `-` operand. `--` explicitly ends option parsing in either mode. If an input read fails, paste preserves the records already read, including a final partial record and its terminator, and reports the error with exit status 1.

Delimiter lists cycle through UTF-8 Unicode code points regardless of locale. Invalid or incomplete UTF-8 bytes are preserved individually. Empty serial inputs emit no terminator, including exhausted repeated stdin operands; a blank input record still emits its terminator. These behaviors intentionally differ from GNU paste. Filename diagnostics keep printable UTF-8 readable and escape control characters, Unicode line and paragraph separators, and unassigned characters as bytes; file lookup uses the original filename.

The module also exports `createPasteCommand`, its command-list factory, and typed options and limits.
