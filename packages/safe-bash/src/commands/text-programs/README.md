# Virtual text-program interpreters

This independently installable family lives entirely in this subtree. It uses
no runtime dependencies, host filesystem operations, subprocesses, `eval`, or
generated JavaScript. It parses programs before running them. Unsupported
syntax is an error, never a successful command-name stub.

## Integration API

`index.ts` exports `textProgramCommands(options?)` (a `VirtualShellPlugin`) and
`createTextProgramCommands(options?)` (command definitions). Both factories
install `sed` and `awk`. Use `shell.use(textProgramCommands())` alongside the
standard command plugin, or add the definitions to a `CommandRegistry`.
The parent command plugin is not edited by this family.

`TextProgramOptions` has `replace?: boolean`, `maxSteps?: number` (default
5,000,000), and `maxBufferBytes?: number` (default 32 MiB). Limits must be positive
safe integers. Plugin setup checks all collisions before registering commands.
The filesystem, streams, and cancellation signal come from `CommandContext`.
Input/output waits use the contracts' cancellation-aware byte helpers. Interpreter
loops yield to the event loop every 256 statement checkpoints; regex execution
is synchronous but step-bounded. Cancellation stops waiting for uncooperative
streams without claiming to undo their side effects. Limits are per invocation
and per buffer, not an aggregate process-memory quota.

## Shared regex execution

Regexes are parsed into a bounded instruction machine, not passed to JavaScript
RegExp for matching. Matching uses byte-oriented C-locale strings and selects
the earliest start and longest whole match at that start. Captures are tracked
for replacements. Supported syntax includes literal bytes, `.`, `^`, `$`,
bracket/range/negated classes, ASCII POSIX classes, grouping, alternatives,
`*`, `+`, `?`, and `{m}`, `{m,}`, `{m,n}` intervals. Basic expressions use escaped
grouping/interval/alternative operators; unescaped ERE operators are literal.

Pattern backreferences to previously closed capture groups are supported with
byte comparisons charged to the execution budget. Distinct capture states are
retained under a state-buffer ceiling; equal whole matches prefer longer
subexpressions in capture order, including ambiguous repeated nested captures.
Collating/equivalence classes, lookaround, and other non-POSIX special groups
are rejected. Exhaustive POSIX subexpression parity is not claimed. Non-ASCII locale folding and
multibyte-character semantics are outside this C-byte-oriented increment.
Regex source is limited to 8,192 bytes, nesting to 64 levels, repetition bounds
to 1,000, and compiled instructions to 16,384. Every matching instruction spends
the invocation's step budget. A costly pattern fails deterministically rather
than entering an uninterruptible native-regex backtracking operation.

## Sed grammar and behavior

Utility dialect policy explicitly retains independently verified GNU sed 4.9
semantics for global `^|$` substitution and successful invocation-wide quit,
including in-place editing. This avoids BSD's suppression of the final anchor
match and truncation of later input files. The two expected results come from
immutable native GNU observations, not from this interpreter. BSD observations
remain in the dialect matrix. This does not claim complete GNU/BSD or Bash
compatibility: ambiguous capture selection, listing presentation, and other
documented differences still exist across native implementations.

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
| `l` | Unambiguous C-byte listing with control/backslash escapes, three-digit octal for other nonprintable bytes, `$` record markers, and 60-column continuation wrapping. Literal backslashes are doubled rather than reproducing BSD's ambiguous single-backslash listing. |
| `d`, `D` | Delete the cycle, or remove the first pattern-space line and restart the program without reading input. |
| `q [status]` | Quit the entire invocation after the current cycle's normal output, including status zero under `-s`/`-i`; optional numeric status 0–255. Later in-place files and backups remain untouched instead of copying BSD's truncation of later files. |
| `a`, `i`, `c` | Queue appended text, immediately insert text, or replace a selected line/range. POSIX backslash-newline text and one-line inline text are accepted. |
| `{ ... }` | Addressed nested command groups. |
| `:label`, `b`, `t`, `T` | Labels, unconditional branches, and substitution-success/failure branches; omitted target ends the current cycle. |
| `h`, `H`, `g`, `G`, `x` | Replace/append hold and pattern spaces, or exchange them. |
| `n`, `N` | Advance input with normal output, or append a record to multiline pattern space. |
| `y/from/to/` | Byte translation with equal-length sets. |
| `r FILE` | Queue raw file bytes after the cycle's normal output; missing/unreadable files contribute no bytes. Reads use the virtual filesystem and propagate cancellation. |
| `w FILE`, `s///w FILE` | Precreate/truncate named outputs after parsing, then append selected pattern spaces with newlines. Substitution writes only changed patterns. Files remain open logically across input files; names extend to the script newline. |

Whitespace, semicolons, newlines, and comments separate commands where their
syntax permits it. Labels are identifiers using letters/digits/underscore/dot/
hyphen and must be defined exactly once. Unknown commands, flags, malformed
groups/regexes, unknown labels, and invalid capture references are checked
before input or output processing. Shell-execution substitutions remain
unsupported; file commands use only the supplied virtual filesystem.

Sed streams line records and buffers only required lookahead/pattern/hold/text
state except in-place editing, which buffers one rewritten file. `-i` requires
named regular files; symlinks and directories are rejected. The buffered in-place
replacement and its backup are deferred until interpretation succeeds. Explicit
`w`/`s///w` commands still have immediate file effects, including when a script
deliberately names an input file as its output.
Nonempty backup suffixes copy the original to `FILE+SUFFIX`; suffixes containing
slash/NUL are rejected. This is not a transaction: copy/write failures or a
later input-file failure can leave earlier completed edits. Writes use the
provider's file operation, not native rename-based replacement, so hardlink and
metadata behavior need not match a particular host sed implementation.

Known sed gaps include GNU zero/step/relative addresses, `R`, `W`,
`e`, `z`, `F`, null-delimited records, sandbox-mode options, locale extensions,
and full in-place metadata/link semantics. Line/hold/file buffers and loops are
subject to the configured limits. Runtime errors can occur after earlier stdout
records; preflight syntax rejection is not a rollback guarantee for execution.

## Awk grammar and behavior

Options: `-F SEPARATOR`, `-v NAME=VALUE`, repeated `-f FILE`, attached versions of
those options, and `--`. Otherwise the first operand is the program. Remaining
operands are input paths, `-` for stdin, or variable assignments. `-v` assignments
precede `BEGIN`; operand assignments take effect as the input argument list is
traversed. Program and data files are exclusively virtual. A BEGIN-only program
does not consume stdin. Other options, including implementation-specific `-W`
options, are rejected.

Programs contain `BEGIN { ... }`, `END { ... }`, ordinary optional-pattern rules,
inclusive `start,end` pattern ranges, and named function definitions. A missing
action prints the current record. A range can start and end on the same record.
Comments, newlines, semicolons, and backslash-newline continuations are supported.
Identifiers use ASCII letters/digits/underscore. String literals support standard
control escapes and up to three octal digits. Numbers are finite decimal values
with optional exponents; arithmetic uses IEEE-754 doubles.

| Area | Implemented behavior |
| --- | --- |
| Records and fields | `$0`, `$expression`, `NF`, `NR`, `FNR`, `FILENAME`; assignment to a field or `NF` rebuilds `$0` using `OFS`, assignment to `$0` resplits it. |
| Separators | `FS=" "` whitespace fields, single-byte literal FS, empty FS byte fields, or ERE FS; single-byte `RS` and empty-RS paragraph mode; `OFS`, `ORS`. |
| Expressions | Arithmetic `+ - * / % ^`, unary signs, prefix/postfix increment/decrement, assignments and compound assignments, concatenation, comparisons, `~`/`!~`, short-circuit `&&`/`||`, `!`, ternary expressions, parentheses. |
| Control flow | Blocks, `if`/`else`, `while`, `do`/`while`, classic `for`, `for (key in array)`, `break`, `continue`, `next`, `nextfile`, `exit [status]`; `END` still runs after exit. |
| Arrays | Associative indexing, comma-separated multidimensional keys via `SUBSEP`, `in` and `(a,b) in array`, element/whole-array `delete`; iteration uses insertion order and does not promise a host awk's unspecified traversal order. |
| Functions | Named functions, recursion, scalar arguments by value, arrays by reference, `return`, and omitted parameters as locals; array parameter roles are inferred before execution. |
| Output | `print`, `printf`, `sprintf`, `OFMT`, `CONVFMT`; virtual-file `>`/`>>` and `close(path)`. The first open chooses truncate/append; subsequent writes append until close. |
| Explicit file input | `getline [variable/field/array] < expression` returns 1/0/-1 for record/EOF/I/O error. It respects RS, leaves NR/FNR unchanged, and resplits fields only when replacing `$0`. File cursors persist until `close(path)` or invocation cleanup; at most 256 may be retained. `"-"` reads stdin; `"./-"` names a literal VFS file. |
| Arguments/environment | Mutable `ARGC`, `ARGV`, and `ENVIRON` initialized only from the command context. Clearing/deleting ARGV entries skips files. ENVIRON changes do not mutate the parent context. |
| String and regex functions | `length`, `substr`, `index`, `split`, `match` with `RSTART`/`RLENGTH`, `sub`, `gsub`, `tolower`, `toupper`. Substitution supports `&` and escaped literals, not sed-style capture backreferences. |
| Math functions | `int`, `sqrt`, `exp`, `log`, `sin`, `cos`, `atan2`; invalid/nonfinite results and division by zero are errors. |

Numeric strings from fields, input assignments, and array keys retain their
original text while participating in numeric comparisons and truth tests. A
literal string `"0"` remains true. Byte-oriented C-locale behavior applies to
field lengths, substrings, comparisons, and ASCII case conversion.

Formatting supports `%c`, `%s`, `%d`/`%i`, `%u`, `%o`, `%x`/`%X`, `%f`/`%F`,
`%e`/`%E`, `%g`/`%G`, `%%`, flags `-+ #0`, numeric or `*` width/precision.
Unsigned/octal/hex conversions use 32-bit unsigned values; arbitrary native
integer-overflow behavior is not promised. Width/integer precision are limited
to 1,000,000, floating precision to 100. Unsupported constant formats are rejected
at parse time; dynamically computed formats are checked when executed.

The parser validates the whole source, literal regexes, function existence and
arity, call targets, and structural control-flow restrictions before processing
input or producing output. Dynamic regexes/values, filesystem failures, resource
limits, and context-dependent errors can fail after earlier output; this is not
transactional execution. Program files must be read before they can be parsed.

Known awk gaps: unredirected/main-input `getline`, command pipes/coprocesses, `system`, `fflush`, random
and time functions, regex/multibyte `RS`, locale/Unicode character semantics,
hexadecimal literals, arbitrary-precision arithmetic, and GNU extensions such
as `gensub`, `patsplit`, `asort`, nested arrays, and special variable behavior
for `FPAT`, `FIELDWIDTHS`, `IGNORECASE`, or `PROCINFO`. Unknown special-variable
names are ordinary user variables; they do not activate unsupported behavior.
Unknown functions/operators are errors, never passed to a host interpreter.

Source is limited to 1 MiB, syntax nesting to 128 levels, function recursion to
64 frames, fields and counted array entries to 100,000 each, and the dynamic
regex cache to 256 entries. The entry count is conservative across discarded
function-local arrays. Records stream from `ByteSource`; a record, input chunk
buffer, expression result, or formatted output must fit the configured buffer
limit. File output writes are awaited, but there are no native file descriptors
or subprocess handles.

## Verification

Run `node --import tsx --test tests/commands/text-programs/*.test.ts` and
`npm run typecheck`. Product code never invokes a host command. Tests alone run
fixed, reviewed native programs through a static `/bin/bash` launcher in fresh
temporary directories, with clean C-locale environments, three-second deadlines,
process-group cleanup, 1 MiB output limits, and complete resulting file snapshots.
No downloaded, generated, or unsupported program is executed by the native oracle.

The suite has 98 passing tests: 33 native sed cases, 51 native awk cases, three
additional preflight/budget/chunk/pipeline tests for each tool, and eight blocked
I/O/busy-loop cancellation tests. Native verification uses macOS `/usr/bin/sed`
and `/usr/bin/awk` (awk version 20200816) on 2026-08-26; this does not claim that
untested platforms were run. Whole-repository typechecking passes at delivery.

The unchanged shell oracle, run with both standard and text-program definitions,
passes 64/64 core and 20/24 advanced-pending fixtures at this checkpoint. The four
remaining failures are shell `case`, two heredocs, and a here-string, not marked
as passing or removed. The corpus and its expected values remain untouched.
Independent verifier tests and comparative benchmark results are separate from
these author checks; no overall superiority claim follows from these counts.
