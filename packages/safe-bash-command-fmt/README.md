# fmt

Format byte-stream paragraphs with GNU coreutils 9.10 line selection, indentation,
prefixes and sentence spacing. The private implementation ships inside Safe Bash;
consumers use `@poe-platform/safe-bash/commands/fmt`.

The supported Node runtime is 22 or newer, using TypeScript/JavaScript ESM and
`Uint8Array` streams. Browser/workerd conditional exports are available;
conditional import checks do not establish qualification in those engines.

Run these commands inside Safe Bash (paths refer to its VFS):

```sh
fmt -w20 /notes.txt
printf 'aa bb cc dd ee' | fmt --width=8
fmt -u -p '> ' /quoted.txt > /formatted.txt
fmt --help
```

The pipeline produces `aa bb cc\ndd ee\n`; with `--width=7` it produces
`aa\nbb cc\ndd ee\n`. These examples use the released 9.10 width boundary,
which excludes the terminating newline. Formatting writes bytes to stdout,
diagnostics to stderr, and returns status 0 on success or 1 on failure.
Formatted lines end in LF even when input has no final LF; a nonmatching
prefix line can retain its missing LF. Long words remain unbroken except for
the raw window-flush behavior described below. No files are modified by fmt itself.

| Supported flags | Meaning |
| --- | --- |
| `-w N`, `--width=N` | Maximum byte length, 0–2500; default 75 |
| `-g N`, `--goal=N` | Preferred byte length, 0 through maximum; default `floor(width * 187 / 200)` |
| `-c`, `--crown-margin` | Preserve first-line and second-line indentation |
| `-t`, `--tagged-paragraph` | Crown behavior, with distinct first/following indentation |
| `-s`, `--split-only` | Split each input line without joining lines |
| `-u`, `--uniform-spacing` | One space between words, two after sentences |
| `-p STRING`, `--prefix=STRING` | Format matching prefixed lines only |
| `--help`, `--version` | Print help or virtual command identity without reading input |
| `--` | End option parsing; following operands are literal paths |
| `-WIDTH` | Legacy width spelling, accepted only as the first argument |

Short flags may be grouped; value flags accept attached or separate values.
Long flags accept separate values and unique abbreviations. Repeated width/goal
options use the last value. Goal-only invocation validates against 75, then sets
maximum to goal + 10. Omitted operands or `-` read stdin. Modes may be combined:
split takes precedence over crown, then tagged. Prefix edge ASCII spaces are
trimmed for matching while retaining minimum indentation and trailing-space
requirements. Sentence boundaries use `.?!` with closing parentheses/brackets
or quotes followed by two spaces or line end.

```ts
import { parseFmtArguments, createFmtEngine, defaultFmtLimits }
  from '@poe-platform/safe-bash/commands/fmt';

const options = parseFmtArguments([new TextEncoder().encode('-w20')]);
const engine = createFmtEngine(options, defaultFmtLimits, signal);
const formatter = engine.run();
```

`run()` is a single-use pure coroutine. Start with `next()`. On an `'input'`
event, resume with a `Uint8Array` of at most 4096 bytes, or `null` for EOF.
Input is copied before control returns. A `Uint8Array` event is owned output;
await its destination write before resuming with `next()`. An `undefined` event
is a cooperative checkpoint; yield to your scheduler before resuming. Do not
send input on output or checkpoint events: unexpected bytes or EOF fail with
`FmtError('INPUT', ...)` and release invocation buffers. Call `dispose()` if you stop early,
including before the first `next()`. Once started, the coroutine's `return()`
also releases buffers. EOF and failures release invocation buffers.

For VFS execution, `fmtCommand({ limits?, profile? })` creates a command definition.
`fmt(context, { width?, goal?, crown?, tagged?, split?, uniform?, prefix?, files?, limits?, profile? })`
returns a typed `FmtResult` with `exitCode` and uses the same parser and engine.
`prefix` accepts a string or opaque bytes; `files` are literal VFS paths and `-`
reads stdin. Alternatively, pass `arguments` as literal byte arrays; combining
raw arguments with formatting options fails explicitly. SDK values are captured
before asynchronous I/O. `fmtCommands({ limits?, profile?, replace? })` registers
the command as an explicit plugin, refusing collisions unless replacement is requested.
Safe Bash's existing `agentCommands()` registration includes fmt.

Formatting treats non-ASCII bytes (including invalid UTF-8) as opaque word bytes;
Unicode blanks do not necessarily delimit words. The default profile is
`gnu-coreutils-9.10-C-bytes`; `gnu-coreutils-8.30-C-bytes` is explicitly historical.

Formatting uses no decoder or terminal-width calculation. Unknown profiles fail
with `FmtError('PROFILE', ...)` before I/O. The historical profile uses its older
exclusive width boundary and separate 8.30 byte snapshots. Explicit `LC_ALL`,
then `LC_CTYPE`, then `LANG` selects diagnostic quoting (default C); formatting
classification is unchanged. Supported names are `C`, `POSIX`, `C.UTF-8` and
`en_US.UTF-8`, case insensitive with `utf8` accepted. Other locales fail before
input acquisition. Unicode diagnostics use a fatal UTF-8 decoder and bundled
glibc 2.31 printable ranges, not host locale discovery or full 9.10 equivalence.

The engine uses the GNU 5000-byte / 998-completed-word windows, including raw
long-word flushes that can put a prefix in the middle of a word. It does not
promise equivalence to whole-paragraph optimization or greedy wrapping.
Costs use checked safe-integer arithmetic and truncating widow/orphan penalties.
Arithmetic overflow is rejected instead of reproducing native C overflow.

Engine retention reserves 10120 bytes plus the owned prefix; word/DP records
are separately capped at 999. Output chunks are owned and at most 1024 bytes.
Copies, resumptions, scans, moves, output bytes and DP candidates consume work.
Parsing/prefix capture and diagnostic decoding are bounded by argument limits.
`accounting()` returns immutable counters; `decodedBytes` is zero, and failures
close the engine.

Default invocation limits (overridable through `limits`):

| Resource | Limit |
| --- | --- |
| Input / formatting output | 32 MiB each, cumulative across file operands |
| Retained byte buffers | 80 KiB |
| Work | 128 Mi units |
| Arguments | 64 KiB total, at most 4096 arguments |

Caller-owned argument/output memory is outside engine retention accounting;
diagnostics are outside formatting-output accounting. Source chunks and fallback
file reads must fit the remaining source-buffer allowance; larger files need a
streaming VFS adapter. Cancellation is explicit and cooperative. Cleanup closes
resource admission and awaits acquired streams/output operations. Pending VFS
metadata creates no resource and is observed without delaying cleanup or opening
late streams; opaque host work cannot be forcibly retired.

Shell redirects are non-atomic: failure may leave partial output, and redirecting
to the input or a symlink alias truncates it before formatting. Shell `noclobber`
is unsupported; use distinct source/destination paths.

The archive hash and development source identity are exposed as `fmtBaseline`.
Source review and original byte tests establish the implemented contract, while
combined punctuation/prefix/margin/window native qualification remains incomplete.
This package has no external runtime dependencies, host executable fallback,
implicit filesystem/network access or downloadable engine.
