# rg

Run `rg` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { rgCommands } from "@poe-platform/safe-bash/commands/rg";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs });
shell.use(rgCommands());
await fs.writeFile("/notes.txt", new TextEncoder().encode("hello world\n"));
const result = await shell.exec("rg hello /notes.txt");
```

Use `rg 'foo ([0-9]+)' -r '$1' file.txt` to print replacements without changing
the file. Replacements support `$0` (the whole match), numbered and named
captures (`$1`, `${1}`, `$name`, `${name}`), and `$$` for a literal dollar sign.
Braces separate a capture name from following text; unmatched or unknown groups
expand to empty text. `-o` prints only replacements, and `-U` supports captures
spanning lines. Output retains UTF-8 bytes and obeys `maxOutputBytes`.

Use `rg -d 1 pattern /dir` (or `--max-depth 1`) to search only files directly
inside `/dir`. Depth `0` skips directory contents.

Use `rg -n -m 18 -M 240 pattern file.log` to replace output lines longer than
240 bytes with an omission marker. `--max-columns` is the long form; `0`
disables the limit. Add `--max-columns-preview` to show the beginning of long
lines followed by an omission marker. Matches, counts, exit status and JSON
output are unchanged.

Word matching (`\w`, `\W`, `\b`, `\B`, and `-w`) recognizes Unicode letters,
combining marks, decimal digits, connector punctuation and join controls.
Unicode property classes include `\p{L}`, `\p{Lu}`, `\pN`, and scripts such as `\p{Greek}`; `\P` negates the property. They also work inside bracket classes.
Matches retain their original UTF-8 byte offsets.

The module also exports `createRgCommand`, its command-list factory, and typed options and limits.

Set `RIPGREP_CONFIG_PATH` to a virtual file containing one argument per line.
Blank lines and comments beginning with `#` are ignored. Configuration is read
for each invocation before command-line arguments, so later command-line options
take precedence. `--no-config` skips the file. Configuration reads obey the
filesystem and input-byte limits.

`-P` and `--pcre2` enable lookahead, lookbehind and backreferences in the
bounded regex interpreter, for example `rg -oP '(?<=key=)\w+' file.txt`.
`--no-pcre2` restores the default dialect; the last flag takes precedence.
This is a supported subset of PCRE2 syntax, not a full PCRE2 engine. An injected
regex provider remains authoritative for matching.
Hex escapes work with or without `-P`: `\x61` and `\x{61}` match `a`, and
`\x09` matches a tab. They also work in character classes and ranges; malformed
escapes and invalid Unicode scalar values fail with exit status 2.

Search recursively with `rg -t ts needle /src`, select paths with `-g`, or list
selected files with `--files`. Add `--glob-case-insensitive` to match all `-g`
patterns without case sensitivity, or use `--iglob` for an individual pattern.
`--sort` and `--sortr` order directory entries by `path`, `modified`,
`accessed`, or `created` (oldest first; `--sortr` reverses the order).
Use `none` to restore the default traversal order.
Hidden files, ignore rules, symlinks and traversal
depth retain the Safe Bash search profile. `rg` is already included by
`baseAgentCommands()` and `agentCommands()`; use `{ replace: true }` when replacing
that registration with a configured `rgCommands()` plugin.

Options expose `maxOutputBytes`, `maxLineBytes`, `maxFileBytes`, `maxFiles` and
`maxPatternBytes`. Supply explicit limits for bounded workloads; omitted limits
retain the existing defaults. An injected `regexExecutor` selects the trusted
provider; the default bounded provider needs no host process or filesystem.
The command implementation is internal and bundled into Safe Bash; consumers
use the public imports above.
