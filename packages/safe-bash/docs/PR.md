# Bounded pr

`pr` paginates virtual files or stdin, prints balanced downward columns, and
merges files side by side. It uses the supplied virtual filesystem and byte
streams, never a native process or an implicit host-file fallback.

```ts
import { Shell, createMemoryFileSystem, prCommands } from "poe-code/safe-bash";

const fs = createMemoryFileSystem();
await fs.writeFile("/input", new TextEncoder().encode("alpha\nbeta\ngamma\ndelta\n"));
const shell = new Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } })
  .use(prCommands({ limits: { maxColumns: 8 } }));
try {
  const result = await shell.exec("pr -t -2 -s'|' input");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The output is `alpha|gamma\nbeta|delta\n`. The command also works in virtual
scripts executed with `sh script.sh`. `agentCommands()` includes `pr`; its
`pr` configuration forwards `clock` and `limits`, while the aggregate plugin
retains its own replacement policy.

## Command interface

`pr [OPTION]... [FILE]...` reads stdin when no files are supplied. `-` names
stdin explicitly; repeated `-` operands share that same stream. Files normally
print sequentially, with independent page and line numbering. `-m` reads them
in parallel, numbering each output row once.

- `-COLUMNS`, `--columns=COLUMNS`: print balanced downward columns on each page.
- `-h HEADER`, `--header=HEADER`: replace the filename in page headers.
- `-l LENGTH`, `--length=LENGTH`: page length, default 66. The default header
  and footer occupy five lines each; lengths at most 10 imply `-t`.
- `-w WIDTH`, `--width=WIDTH`: page width for column output, default 72.
  This option alone does not truncate single-column input.
- `-t`, `--omit-header`: omit headers and footers, retaining input formfeeds.
- `-n[SEP[DIGITS]]`, `--number-lines[=SEP[DIGITS]]`: line numbers, default
  five digits followed by a tab. Excess high-order number digits are omitted.
- `-m`, `--merge`: one column per file; incompatible with an explicit column count.
- `-s[SEP]`, `--separator[=SEP]`: separator bytes. Without `-w`, this disables
  column alignment/truncation; with `-w`, clipping remains enabled.

The optional arguments of `-s` and `-n` must be attached. For example, `-s:`
sets a colon separator, but `-s :` attempts to open the file named `:`. A bare
`-s` uses tabs without `-w`, and an empty separator with `-w`. As in the
reference utility, attached multi-byte separator strings are accepted.

Also implemented: `-a`/`--across`, `-d`/`--double-space`, `-f`/`-F`/`--form-feed`,
`-J`/`--join-lines`, `-T`/`--omit-pagination`, `-W`/`--page-width`,
`-S[STRING]`/`--sep-string[=STRING]`, `-N`/`--first-line-number`,
`-o`/`--indent`, `-r`/`--no-file-warnings`, `-c`/`--show-control-chars`,
`-v`/`--show-nonprinting`, `-e[CHAR[WIDTH]]`/`--expand-tabs`, and
`-i[CHAR[WIDTH]]`/`--output-tabs`. The legacy `-b` is accepted; downward
columns are always balanced. Long-option unique abbreviations and `--`
option termination are supported. The information options `--help` and
`--version` describe this virtual implementation, not a GNU release banner.

Custom date formats (`-D`/`--date-format`) and page selection
(`+FIRST[:LAST]`/`--pages`) are not implemented. This is not the complete GNU
option surface.

Formfeeds are page boundaries, including blank pages. A newline immediately
following a formfeed is consumed. A formfeed immediately after a complete
page may be suppressed rather than creating an extra page. In merge mode a
formfeed holds only that input until the other columns finish their page.
Trailing empty columns, tabs and spaces follow the reference formatting;
they are not normalized or trimmed after formatting.

## SDK configuration

The package and `poe-code/safe-bash/commands/pr` export `createPrCommand`,
`createPrCommands`, `prCommands`, `PrCommandsOptions` and `PrLimits`.

`PrCommandsOptions` accepts:

- `replace?: boolean`: permit replacement in `prCommands`; default false.
- `clock?: () => number`: synchronous current time in milliseconds since the
  Unix epoch; default `Date.now`. Stdin and merge headers share one sample per
  invocation, including multiple pages. Named files use `stat().mtimeMs`.
  Timestamp initialization is eager, including when headers are suppressed,
  consistent with the reference source. Invalid timestamps fail explicitly.
- `limits?: Partial<PrLimits>`: override the limits below. Each supplied limit
  must be a positive safe integer. Limits are validated at factory creation.

| Limit | Default |
| --- | ---: |
| `maxArguments` | 4,096 |
| `maxArgumentBytes` | 65,536 |
| `maxFiles` | 128 |
| `maxColumns` | 128 |
| `maxPageLines` | 65,536 |
| `maxPageWidth` | 65,536 |
| `maxPages` | 65,536 |
| `maxInputBytes` | 33,554,432 |
| `maxBufferedBytes` | 16,777,216 |
| `maxLineBytes` | 1,048,576 |
| `maxLines` | 1,048,576 |
| `maxOutputBytes` | 67,108,864 |
| `maxDiagnosticBytes` | 65,536 |
| `maxWork` | 134,217,728 |
| `maxEmptyChunks` | 4,096 |

Input bytes, lines, page attempts, output and work share one invocation budget
across all files. `maxPages` bounds page-processing attempts, including the
final EOF-detection attempt in non-buffered modes. Formfeeds consume the
input-record budget too. `maxEmptyChunks` applies per input reader.
`maxPageWidth` also bounds indentation, numbering width and tab stops.
`maxBufferedBytes` bounds command-owned retained payload, string storage and
page-line bookkeeping; it is not a host-process RSS guarantee. Diagnostics
have a separate bounded byte/work allowance (including their transient string
and byte encoding storage) so exhausted payload budgets can still be reported.
The shell's enclosing output/operation limits remain effective as well.

## Bytes, locale and time

The primary native qualification is GNU coreutils 8.30, Ubuntu
8.30-3ubuntu2, with C locale and UTC. The source is the Ubuntu applied commit
`26a1fa64acd11d62b28a59fab6b938ab57d12ba7`; the complete `pr.c` SHA-256 is
`cc8fdf01d300949bb1c4235b26b5c99359556294e0bded7174f08085b7aeaea1`.
Finite byte/status comparisons are evidence for their inputs, not universal
parity with all GNU versions, locales, timestamps or filesystem providers.

The command reads `LC_ALL`, `LC_CTYPE`, `LC_TIME`, `LANG`, `TZ` and
`POSIXLY_CORRECT` from the supplied command environment. Supported locale
names are `C`, `POSIX`, `C.UTF-8` and `C.utf8`. Body formatting is byte-based,
not Unicode terminal-cell formatting: non-ASCII bytes have zero display width
in the reference's per-byte character processing. NUL, CR, invalid UTF-8
payloads and high bytes are preserved, subject to requested control-character
display options. Backspace and tab processing can intentionally remove or
transform bytes; raw preservation is not a claim that `pr` is a byte copier.

Header display width is qualified in C/POSIX. C UTF-8 locales permit ASCII
headers; non-ASCII headers in those locales are rejected rather than given
invented Unicode widths. Diagnostics use English C-style quotation; localized
messages and all C UTF-8 diagnostic quotation variants are not qualified.

An absent or empty `TZ` means UTC rather than the host timezone. Accepted
explicit spellings are `UTC`, `UTC0`, `:UTC`, `GMT` and `GMT0`; other timezones
are rejected if a header would actually be printed. Headerless and empty input
does not need timezone or header-width interpretation. No host timezone
database is consulted. Default header dates
use `YYYY-MM-DD HH:MM`. Presence of `POSIXLY_CORRECT`, even with an empty
value, selects `Mon DD HH:MM YYYY` for C/POSIX time locales.

VFS filenames must be well-formed UTF-8; a leading UTF-8 BOM is part of the
filename. Invalid UTF-8 argv paths cannot alias replacement-character names.
NUL arguments and unpaired JavaScript UTF-16 surrogates are rejected. Header
and separator arguments retain their admitted raw bytes.

## Failure and resource behavior

The command only reads regular VFS files and supplied stdin. It does not open
special files as native devices. Symlink resolution stays within the supplied
filesystem's authority. Providers need usable file metadata; non-streaming
providers must satisfy the bounded `readFile` admission check.

Missing operands produce diagnostics and allow remaining files to print.
Directory and subsequent read failures are fatal, preserving already emitted
output, including an incomplete merge row. No input contents are changed.
There is no output rollback after a limit, I/O failure or cancellation.

Source chunks are copied before advancing their producer. Cooperative reads,
owned output writes and iterator cleanup are registered before acquisition
and drained during shutdown. Original falsey cancellation reasons remain
distinct. Cleanup I/O failures are not discarded; primary and cleanup failures
are retained together. These guarantees depend on faithful provider and shell
wrappers and do not forcibly preempt arbitrary uncooperative host JavaScript.
