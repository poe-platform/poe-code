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

Use `rg -d 1 pattern /dir` (or `--max-depth 1`) to search only files directly
inside `/dir`. Depth `0` skips directory contents.

The module also exports `createRgCommand`, its command-list factory, and typed options and limits.

Set `RIPGREP_CONFIG_PATH` to a virtual file containing one argument per line.
Blank lines and comments beginning with `#` are ignored. Configuration is read
for each invocation before command-line arguments, so later command-line options
take precedence. `--no-config` skips the file. Configuration reads obey the
filesystem and input-byte limits.

`-P` and `--pcre2` fail with exit status 2: PCRE2 is unavailable.
Ordinary patterns use the bounded regex dialect, including with an injected provider.
