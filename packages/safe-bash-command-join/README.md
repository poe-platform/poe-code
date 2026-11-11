# join

Run `join` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Missing and extra file operands produce GNU-style diagnostics and a `--help` hint, with exit status 1 and no stdout. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { joinCommands } from "@poe-platform/safe-bash/commands/join";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(joinCommands());
const result = await shell.exec("join --help");
```

The module also exports `createJoinCommand`, its command-list factory, and typed options and limits. Use `-` for either input to read standard input; using it for both inputs fails with `join: both files cannot be standard input`. The `--help`, `--version`, `--header`, `--ignore-case`, `--check-order`, `--nocheck-order`, and `--zero-terminated` options accept unique prefixes, such as `--hel`, `--ver`, `--hea` and `--ignore`; ambiguous `--h` and `--he` are rejected.

Field numbers for `-1`, `-2`, `-j`, and `-o` accept positive decimals above JavaScript's safe integer range and saturate at 9223372036854775807, matching 64-bit GNU `join`. Fields past the end of a row are empty; repeated join-field options must agree after saturation. Explicit `-o` field lists take precedence over `-o auto` in either order. `-a` and `-v` still select only file 1 or 2.

With `-z`, trailing spaces, tabs and newlines do not create extra fields, matching GNU coreutils 9.10. An explicit `-t` delimiter still preserves empty fields in nonempty records; empty records contain zero fields.

`-t` accepts a single UTF-8 character when the locale selected by `LC_ALL`, `LC_CTYPE`, or `LANG` uses UTF-8. For example, `LC_ALL=C.UTF-8 join -t é left right` splits and joins fields with `é`. Without `-t`, UTF-8 locales also split on GNU locale blanks such as em spaces and ideographic spaces; nonbreaking spaces remain part of fields. C/POSIX locales and an unset locale retain single-byte delimiters and ASCII blank splitting. The same locale selection lets `-o` field lists use Unicode blanks such as EM SPACE (U+2003) and IDEOGRAPHIC SPACE (U+3000), matching GNU coreutils 9.10. Commas, ASCII spaces, and tabs work in every locale; C/POSIX and an unset locale reject Unicode blanks. A list may end with one separator, but leading or repeated separators are invalid.

Merging, matching key groups, and order checks use `LC_ALL`, then `LC_COLLATE`, then `LANG` (ignoring empty values). C/POSIX locales retain byte order, including the UTF-8 spellings `C.UTF-8`, `C.utf8`, `C.UTF8`, and `C.utf-8`; supported language locales use runtime Unicode collation, with byte comparison to break ties. Distinct keys such as `é` and `e` followed by a combining acute accent, or `a` and `a` followed by a soft hyphen, remain separate without normalizing their bytes. Identical non-ASCII keys still match. If a requested locale or its explicit codeset is unsupported, all categories fall back to C: byte ordering, ASCII blank splitting, and single-byte delimiters. For example, `en_US.NO_SUCH_CODESET` uses C ordering even though English collation is available. `--ignore-case` retains folded byte comparison.

Default order checking starts after reading past the first unpaired row while both files still have rows, matching GNU coreutils. Earlier descending keys are not reported retroactively. Rows remaining after the other file ends do not start default checking. Use `--check-order` to check all input rows, or `--nocheck-order` to disable checking. Order diagnostics identify the input operand, its 1-based record number (including headers), and the offending record, for example `join: left:3: is not sorted: a`.
