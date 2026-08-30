# Stream inspection commands

This source module defines `tac`, `expand`, `fold`, and `strings`. It adds no
runtime dependencies, host process execution, host filesystem fallback, shell
builtins, network access, or ambient credentials. The package root and
`virtual-bash/commands/stream-inspection` now export the two factories and types
below. All four commands are included in `agentCommands()`/`createAgentCommands()`;
configure their limits through `streamInspection.limits`. Do not also install
the standalone plugin unless replacement is intentional. Curl and SafeJS remain
optional and are not enabled by these commands.

`createStreamInspectionCommands(options?)` returns `readonly CommandDefinition[]`.
`streamInspectionCommands(options?)` returns a `VirtualShellPlugin` and preflights
all four collisions before registering anything. `replace: true` explicitly
replaces existing definitions. `StreamInspectionCommandsOptions.limits` accepts
partial positive-safe-integer overrides of `StreamInspectionLimits`.

The original source integration tests import this module directly, register it on an actual
`Shell` alongside `standardCommands()`, and run memory/explicit-root real VFS
pipelines. Those source-level tests are not proof of an installed package export;
the separate public/default integration is recorded under
`tests/integration/stream-inspection-public-author/`. The original opt-in author
handoff and its evidence remain historical, unchanged records.

## Command profiles

All commands accept multiple VFS files, default to stdin when no operands are given,
support `--` and attached/separate short option arguments, and diagnose unknown
options rather than silently ignoring them. Options may occur after operands.
There is no text decoding of input. Every non-transformed byte, including NUL,
invalid UTF8, multibyte UTF8, and CR, survives exactly. No newline is fabricated
at EOF except the output terminator of each selected `strings` run.

### tac

Default LF-delimited records are reversed separately in each operand. The
separator belongs to the preceding record; an unterminated final record moves
to the front without gaining a delimiter. `-b`, `--before` attaches delimiters
to the following record. `-s STRING`, `--separator=STRING` uses literal UTF8
argument bytes, not regex or escape processing. An empty separator means one
NUL byte, as verified with GNU9.7. Overlapping delimiters are found from right
to left without overlap. `-` is stdin, and repeated stdin operands share one
cursor rather than replaying the input.

The entire operand is collected before reversal; there is no seek, disk spool,
or constant-memory claim. Reverse matching uses a linear prefix-table scan,
with cooperative cancellation/work checks. `-r`/`--regex` is not implemented;
this is a remaining compatibility gap, not an unchanged full GNU profile.

### expand

Default tab stops repeat every8 byte columns. `-t LIST`, `--tabs=LIST` accepts
a single repeating interval or ascending explicit stops separated by commas
or ASCII space/TAB. Repeated `-t` options accumulate stops. Empty fields/list match
GNU9.7 behavior. Beyond a finite list, tabs become one space. A final `/N`
repeats at absolute multiples of N; a final `+N` repeats from the last explicit
stop. `-i`, `--initial` changes only tabs before the first non-space/non-tab byte
on a line. Backspace decreases the column without being removed; LF resets
columns. Other bytes, including CR, advance one column. State spans operands,
including unterminated boundaries, matching inspected GNU9.7 source.

The transform is incremental, flushes each input chunk, and awaits output before
requesting another chunk. Numeric `-4`/`-4,8` syntax is accepted under the pinned
GNU9.7 Darwin profile. Zero repeat markers mean an unset interval: zero-only
defaults to 8, one explicit stop repeats, and multiple stops remain finite.
Numeric suffix parsing, repeated options and operand permutation retain the
accepted numeric-fixer behavior rather than a newly narrowed flag profile.

### fold

`-w N`, `--width=N` sets a positive width (default80). `-b`, `--bytes` counts
every non-LF byte as one. Otherwise the fixed C/POSIX byte-column profile uses
8-column tabs, decrementing backspace, reset-on-CR, and one column for every
other byte. `-s`, `--spaces` wraps after the last ASCII space or tab already
buffered when width would be exceeded; the blank is preserved. Tabs can exceed
a narrow requested width by themselves, as GNU9.7 does. Each operand starts
with a fresh column and pending-line buffer.

Pending output is record-bounded, including a long CR/backspace-heavy sequence
whose display column never reaches the width. UTF8 is preserved, not interpreted
as display cells or characters. Locale environment values do not switch this
byte profile and are not rejected. This does not claim Unicode display-width
parity or newer GNU character modes. Numeric `-WIDTH` syntax (for example `-3`)
is supported under the pinned GNU9.7 Darwin profile; every supplied width is
validated before the last valid width is used.

### strings

Whole-data raw inspection is the fixed default; `-a`, `--all` explicitly selects
the same policy. A lone `-` selects all-data scanning, **not an input operand**;
it is removed from the file list, so `strings - file` does not consume stdin.
Use `./-` for a VFS file literally named `-`. With no operands, stdin is scanned.
An operand list consisting only of `-` entries is a usage error, not stdin:
GNU2.44's native behavior is preserved with a shorter utility diagnostic.
This follows the GNU raw/all-data distinction; no object format is parsed.

`-n N`, `--bytes=N` sets a positive minimum run length (default4). Runs contain
ASCII bytes32–126 plus TAB; other bytes terminate them, including newline, CR,
NUL, and bytes128–255. `-t d|o|x`, `--radix=...` prints the starting byte offset
in a minimum seven-character right-aligned field. `-f`, `--print-file-name`
prefixes the literal operand, or `{standard input}`, followed by `: `.
Offsets reset for each file; each accepted run ends with LF, including at EOF.

This is a useful binary marker extractor, not Unicode string decoding or a
claim of object-section analysis. GNU `-d`, `-e`, `-U`, `-w`, output-separator
options and `-o` are remaining compatibility gaps. Numeric `-NUMBER` syntax is
supported under the pinned GNU strings2.44 Darwin profile, including leading-zero
octal lengths and deferred numeric selection overriding valid ordinary `-n`.
Zero and unsigned overflow are rejected. Legacy getopt ordering quirks are
preserved in the numeric-fixer fixtures, not normalized into a different parser.
Apple strings differs on TAB inclusion and offset padding; its expected bytes
are not substituted for GNU behavior. A later isolated reference build supplies
GNU strings2.44 with the raw/default-all configuration. The supplemental13-case
author cohort includes12 exact positive workflows and the lone-`-` usage-negative
whose diagnostic wording differs. Earlier unavailable/failed observations stay
in the evidence; this does not establish full strings compatibility.

## Limits, streaming, and errors

| Limit | Default | Scope |
| --- | ---: | --- |
| maxInputBytes | 32MiB | All accepted input chunks across operands |
| maxOutputBytes | 64MiB | stdout byte writes across operands |
| maxRecordBytes | 8MiB | tac emitted record, fold pending buffer, strings run |
| maxChunkBytes | 1MiB | Maximum single input chunk; readFile fallback maximum |
| maxFiles | 64 | Operand count after default-stdin selection |
| maxSteps | 268435456 | Chunk pulls, scanning/recomputation and output work |
| maxArgumentBytes | 65536 | Sum of UTF8 argument byte lengths |

These are per-invocation family limits, not a replacement for shell-wide shared
command/output/depth budgets. stderr diagnostics still pass through the existing
shell sink budget; the family stdout counter does not count diagnostic bytes.
Each invocation validates arguments/files before opening data. Large legitimate
files/records may need explicit limits; a denied limit is a failure, not an
unsupported native pass. Input chunks are bounded even when supplied by the host.
For adapters without `readStream`, `readFile` receives the signal and a bounded
`maxBytes`; a large whole-file fallback can be rejected even when total input
budget is larger. It is not silently treated as a streaming read.

All writes use `writeBytes` with the supplied/combined signal and are awaited.
Retained data and published sink chunks own their bytes, including Buffer inputs.
An invocation yields to the event loop every4096 work units, so empty producers
and CPU-heavy scans can be interrupted. Owned VFS transfer signals are aborted
when their stream closes; caller signals are never aborted by the module.
Pending I/O is raced through `readBytes`/`writeBytes`; late rejections are observed.
Cancellation preserves the exact reason even when it resembles an FsError.
It cannot undo completed writes or forcibly terminate uncooperative host work.

Missing/directory/read failures retain the underlying diagnostic meaning/path
and allow later operands to run with exit1. Limits, output failures and invalid
options terminate the invocation with a diagnostic and exit1. Cancellation
rejects rather than becoming a utility error. Already-published partial bytes
are not rolled back. `tac` does not publish an operand until its input is fully
collected; fold/strings may have unpublished buffered data at a read failure.

## Evidence and reproduction

Original source-author evidence and tests live in `tests/commands/stream-inspection/`.
`evidence/SELECTION.md` preserves the exact measured50+4 cohort and the current
registry count correction. `evidence/NATIVE-ATTEMPTS.md` preserves initial Apple
parser failures and the explicit corrected fixtures; native stdout/stderr and
executable hashes are retained. Independent holdouts are a separate denominator.

Run from the repository root:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/stream-inspection/*.test.ts
STREAM_NATIVE_LIVE=1 node --unhandled-rejections=strict --import tsx --test tests/commands/stream-inspection/native.test.ts tests/commands/stream-inspection/gnu-strings.test.ts
```

The live check requires the exact retained GNU9.7 binaries (override directory
with `STREAM_GNU_BIN`), GNU strings2.44 (`STREAM_GNU_STRINGS`), and recorded Apple
tooling. No dependency is installed by the tests.
The oracle runner creates/deletes only uniquely named author fixtures within its
own test subtree; its publication uses `apply_patch`. Root dist is not built.

Primary profiles consulted: installed GNU9.7 `src/{tac,expand,fold}.c` and
`doc/coreutils.texi`, official GNU Coreutils tac/expand/fold invocation manuals,
and the official GNU Binutils strings manual. Runtime behavior and hashes are
decisive for the pinned native cohort, not a claim that a changing web manual
matches this installed release. This scoped module does not establish broad
GNU parity, a current full gate, superiority over just-bash, or product completion.
