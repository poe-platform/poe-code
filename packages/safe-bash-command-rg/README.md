# rg

Run `rg` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { rgCommands } from "@poe-platform/safe-bash/commands/rg";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(rgCommands());
const result = await shell.exec("rg --help");
```

Use `rg 'foo ([0-9]+)' -r '$1' file.txt` to print replacements without changing
the file. Replacements support `$0` (the whole match), numbered and named
captures (`$1`, `${1}`, `$name`, `${name}`), and `$$` for a literal dollar sign.
Braces separate a capture name from following text; unmatched or unknown groups
expand to empty text. `-o` prints only replacements, and `-U` supports captures
spanning lines. Output retains UTF-8 bytes and obeys `maxOutputBytes`.

The module also exports `createRgCommand`, its command-list factory, and typed options and limits.
