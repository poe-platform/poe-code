# join

Run `join` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { joinCommands } from "@poe-platform/safe-bash/commands/join";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(joinCommands());
const result = await shell.exec("join --help");
```

The module also exports `createJoinCommand`, its command-list factory, and typed options and limits. The `--header`, `--ignore-case`, `--check-order`, `--nocheck-order`, and `--zero-terminated` options accept unique prefixes, such as `--hea` and `--ignore`; ambiguous `--h` and `--he` are rejected.

Field numbers for `-1`, `-2`, `-j`, and `-o` accept positive decimals above JavaScript's safe integer range and saturate at 9223372036854775807, matching 64-bit GNU `join`. Fields past the end of a row are empty; repeated join-field options must agree after saturation. `-a` and `-v` still select only file 1 or 2.

With `-z`, trailing spaces, tabs and newlines do not create extra fields, matching GNU coreutils 9.10. An explicit `-t` delimiter still preserves empty fields.

`-t` accepts a single UTF-8 character when the locale selected by `LC_ALL`, `LC_CTYPE`, or `LANG` uses UTF-8. For example, `LC_ALL=C.UTF-8 join -t é left right` splits and joins fields with `é`. Without `-t`, UTF-8 locales also split on GNU locale blanks such as em spaces and ideographic spaces; nonbreaking spaces remain part of fields. C/POSIX locales and an unset locale retain single-byte delimiters and ASCII blank splitting.

Default order checking starts after reading past the first unpaired row while both files still have rows, matching GNU coreutils. Earlier descending keys are not reported retroactively. Rows remaining after the other file ends do not start default checking. Use `--check-order` to check all input rows, or `--nocheck-order` to disable checking.
