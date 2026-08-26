# Virtual text-program interpreters

This independently installable family lives entirely in this subtree. It uses
no runtime dependencies, host filesystem operations, subprocesses, `eval`, or
generated JavaScript. It parses programs before running them. Unsupported
syntax is an error, never a successful command-name stub.

## Integration API

`index.ts` exports `textProgramCommands(options?)` (a `VirtualShellPlugin`) and
`createTextProgramCommands(options?)` (command definitions). The current
increment installs `sed`; the `awk` interpreter is the next increment.
The parent command plugin is not edited by this family.

`TextProgramOptions` has `replace?: boolean`, `maxSteps?: number` (default
5,000,000), and `maxBufferBytes?: number` (default 32 MiB). Limits must be positive
safe integers. Plugin setup checks all collisions before registering commands.
The filesystem, streams, and cancellation signal come from `CommandContext`.

## Shared regex execution

Regexes are parsed into a bounded instruction machine, not passed to JavaScript
RegExp for matching. Matching uses byte-oriented C-locale strings and selects
the earliest start and longest whole match at that start. Captures are tracked
for replacements. Supported syntax includes literal bytes, `.`, `^`, `$`,
bracket/range/negated classes, ASCII POSIX classes, grouping, alternatives,
`*`, `+`, `?`, and `{m}`, `{m,}`, `{m,n}` intervals. Basic expressions use escaped
grouping/interval/alternative operators; unescaped ERE operators are literal.

Pattern backreferences, collating/equivalence classes, lookaround, and other
non-POSIX special groups are rejected. Full POSIX subexpression tie-breaking
for ambiguous nested captures is not claimed. Non-ASCII locale folding and
multibyte-character semantics are outside this C-byte-oriented increment.
Regex source is limited to 8,192 bytes, nesting to 64 levels, repetition bounds
to 1,000, and compiled instructions to 16,384. Every matching instruction spends
the invocation's step budget. A costly pattern fails deterministically rather
than entering an uninterruptible native-regex backtracking operation.

## Sed grammar and behavior

Options: `-n`, repeated ordered `-e PROGRAM`/`-f FILE`, `-E`/`-r`, `-s`, and
`-i[SUFFIX]`. `-i ''` is also accepted for a BSD-style empty backup suffix.
Other long/short options are rejected. A first-line `#n` suppresses automatic
printing. Program files are read through the virtual filesystem.

An instruction has zero, one, or two comma-separated addresses, optional `!`,
and a command. Addresses are positive line numbers, `$`, `/regex/`, or an
alternative escaped delimiter such as `\#regex#`. Empty regexes reuse the last
executed regex. Address ranges are inclusive; a regex range end is tested
starting with the next input line, and a numeric end at/before its start matches
one line. Ordinary multiple files form a single addressed stream; `-s` and
in-place editing reset line/range/hold state per file.

| Command | Implemented behavior |
| --- | --- |
| `s/regex/replacement/flags` | First, numbered, global, or numbered-and-later substitution; `p` prints changed pattern space; `I`/`i` ignores case. Replacement `&` and `\1`…`\9` expand matches/captures; escaped literals and newline/tab work. |
| `p`, `P`, `=` | Print pattern space, its first line, or the input line number. |
| `d`, `D` | Delete the cycle, or remove the first pattern-space line and restart the program without reading input. |
| `q [status]` | Quit after the current cycle's normal output; optional numeric status 0–255. |
| `a`, `i`, `c` | Queue appended text, immediately insert text, or replace a selected line/range. POSIX backslash-newline text and one-line inline text are accepted. |
| `{ ... }` | Addressed nested command groups. |
| `:label`, `b`, `t`, `T` | Labels, unconditional branches, and substitution-success/failure branches; omitted target ends the current cycle. |
| `h`, `H`, `g`, `G`, `x` | Replace/append hold and pattern spaces, or exchange them. |
| `n`, `N` | Advance input with normal output, or append a record to multiline pattern space. |
| `y/from/to/` | Byte translation with equal-length sets. |

Whitespace, semicolons, newlines, and comments separate commands where their
syntax permits it. Labels are identifiers using letters/digits/underscore/dot/
hyphen and must be defined exactly once. Unknown commands, flags, malformed
groups/regexes, unknown labels, and invalid capture references are checked
before input or output processing. Shell-execution substitutions and `r`/`w`
file commands are deliberately unsupported, not delegated to host tools.

Sed streams line records and buffers only required lookahead/pattern/hold/text
state except in-place editing, which buffers one rewritten file. `-i` requires
named regular files; symlinks and directories are rejected. A file is not
changed, and its backup is not created, until its interpretation succeeds.
Nonempty backup suffixes copy the original to `FILE+SUFFIX`; suffixes containing
slash/NUL are rejected. This is not a transaction: copy/write failures or a
later input-file failure can leave earlier completed edits. Writes use the
provider's file operation, not native rename-based replacement, so hardlink and
metadata behavior need not match a particular host sed implementation.

Known sed gaps include GNU zero/step/relative addresses, `l`, `r`/`R`, `w`/`W`,
`e`, `z`, `F`, null-delimited records, sandbox-mode options, locale extensions,
and full in-place metadata/link semantics. Line/hold/file buffers and loops are
subject to the configured limits. Runtime errors can occur after earlier stdout
records; preflight syntax rejection is not a rollback guarantee for execution.

## Verification

Run `node --import tsx --test tests/commands/text-programs/*.test.ts` and
`npm run typecheck`. Product code never invokes a host command. Tests alone run
fixed, reviewed native programs through a static `/bin/bash` launcher in fresh
temporary directories, with clean C-locale environments, three-second deadlines,
process-group cleanup, 1 MiB output limits, and complete resulting file snapshots.
No downloaded, generated, or unsupported program is executed by the native oracle.

The sed increment has 33 native differential cases and three additional
preflight/budget/chunk/pipeline tests. Verification is against macOS `/usr/bin/sed`
on 2026-08-26; portability is not a claim that untested platforms were run.
Existing shell oracle fixtures and their expected values remain untouched.
