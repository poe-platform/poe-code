# Format tables with column

This dependency-free TypeScript ESM module registers the virtual `column`
command. It reads only supplied ByteIO/VFS objects. It does not spawn processes,
inspect host files, discover terminals, load locale databases, or use network.
It is not full BSD/util-linux compatibility, and `column` is not a GNU utility.
The command is available through the existing Safe Bash public exports and command inventory.

## Inspected API

Use the public Safe Bash exports; the implementation workspace is internal and bundled.

```ts
import { columnCommands, createColumnCommand, createColumnCommands }
  from "@poe-platform/safe-bash/commands/column";

shell.use(columnCommands({ limits: { maxInputBytes: 1024 * 1024 } }));
const definition = createColumnCommand();
const definitions = createColumnCommands({ replace: true });
```

The snippet's `shell` is a caller-created `Shell` with an explicit VFS. Factories
return a `CommandDefinition` or readonly array containing only `column`.
`ColumnCommandsOptions` has `replace?: boolean` and
`limits?: Partial<ColumnLimits>`. `replace` is a plugin registration policy;
definitions themselves do not mutate a registry. Plugin collision preflight
happens before registration. Options/limits are snapshotted at factory creation.
There is no default aggregation or network capability.

## Supported command profile

| Option | Behavior |
| --- | --- |
| `-t`, `--table` | Align fields in a buffered table; default separator is ASCII space, TAB, CR, VT, FF. Runs collapse and leading/trailing whitespace is discarded. |
| `-J`, `--json` | Emit a JSON table; implies table mode and requires named columns. Empty and absent cells become `null`; values remain strings. |
| `-N names`, `--table-columns names` | Comma-separated column names; table output includes aligned headings. JSON keys fold ASCII uppercase to lowercase. |
| `-n name`, `--table-name name` | JSON table name, default `table`; folds ASCII uppercase to lowercase. |
| `-C definition`, `--table-column definition` | Repeatable declarative columns, for example `name=COUNT,right`. Supports `name`, `right`, `hidden`, `trunc`, `wrap`, `strictwidth`, and the util-linux 2.39.3 strict-width spelling `noextremes`. Cannot combine with `-N`. Other properties are rejected; `hide` is accepted without setting `hidden`, as in 2.39.3. |
| `-O columns`, `--table-order columns` | Put the listed names or one-based column numbers first, followed by remaining columns. |
| `-H columns`, `--table-hide columns` | Hide selected columns, including unnamed columns selected with `-`. An explicitly empty defined heading is still named. |
| `-R columns`, `--table-right columns` | Right-align selected cells. |
| `-T columns`, `--table-truncate columns` | Truncate selected cells when the table exceeds the output width. |
| `-W columns`, `--table-wrap columns` | Wrap selected cells onto continuation lines when needed to fit. |
| `-E columns`, `--table-noextreme columns` | Allow unusually long cells to exceed their calculated column width, moving following cells onto another line. |
| `-l count`, `--table-columns-limit count` | Limit input splitting; the last column retains the original unsplit remainder, including spacing. |
| `-d`, `--table-noheadings` | Suppress headings while retaining their layout metadata. |
| `-e`, `--table-header-repeat` | Repeat headings after 24 output lines; uses a fixed nonterminal height. |
| `-m`, `--table-maxout` | Expand column padding to the output width, including the final column. |
| `-L`, `--keep-empty-lines` | Retain empty records; table lines include column padding. |
| `-s chars`, `--separator chars`, `--input-separator chars` | Table-only set of Unicode scalar delimiters, not a substring, regex, CSV parser, or escape parser. Repeated/leading/trailing delimiters produce empty cells. Empty delimiter set is an error. |
| `-o text`, `--output-separator text` | Table-only output delimiter, default two spaces. Empty text is allowed; controls, tabs and newlines are rejected. Delimiters follow alignment padding; this does not turn output into CSV. |
| `-c width`, `--output-width width` | Positive decimal layout width up to `maxWidth`; default 80, reduced to `maxWidth` if the host sets a smaller bound. Table resizing applies to selected wrapping, truncation, extreme-cell and maxout columns. |
| `-x`, `--fillrows` | Fill across rows, instead of default down columns. Cannot combine with `-t`. |
| `-h`, `--help` | Describe the real implemented profile without acquiring input. |
| `--` | End options; following dash-prefixed operands are VFS paths. |
| `-` | Shared stdin, exhausted once; repeated `-` does not restart or reacquire stdin. |

Short flags may cluster; argument-taking flags accept attached arguments, such
as `-ts:` or `-xc16`. Long value options accept `=value`. No `COLUMNS`, `LANG`,
`LC_ALL`, terminal state or color environment affects behavior.

Without `-t`, each nonblank input record is one entry. A common column stride is
the next strictly greater multiple of eight above the maximum display width.
Fit as many strides as the requested width permits, at least one; `-x` changes
entry traversal, not the stride. Inter-column padding uses actual TAB bytes at
eight-column stops. Entries wider than `-c` are emitted intact on their own line.
Table padding uses spaces. Its prospective absent-tail profile preserves the
padding and output separators up to the table's final column, even when a row
has fewer actual fields. It does not pad the final column's absent content or
add data cells. Explicit empty fields keep their original meaning. For example,
`a b c` followed by `d` produces `a  b  c\nd     \n`. Fill mode still does not
pad after its last entry. This is a root-authorized compatibility evolution from
the previous absent-tail omission policy, not a retroactive bug designation.

Column flag lists accept names, one-based numbers, bounded numeric ranges,
`0` for all columns, `-` for unnamed columns and `-1` for the last visible column.
JSON selection and ordering use the same column metadata; unnamed extra data
is an error unless `-H -` hides it. Empty input emits no output. JSON whitespace
follows the util-linux 2.39.3 writer, including its adjacent-object separators.

Colors/ANSI handling, tree/depth processing,
`--use-spaces`/`-S`, `--version`, legacy `--columns`, zero/unlimited width and all
other unlisted options are rejected, not silently ignored. No `maxDepth` is
needed: input/layout has no recursion or tree traversal. `du` is deferred.

## Records, errors, and byte ownership

LF is the record boundary. Empty records are ignored unless `-L`; whitespace-only default
table records and space/TAB-only fill records are ignored. With explicit `-s`,
space-only records are data unless space belongs to the delimiter set. A final
nonempty unterminated record is accepted. Files concatenate **records**, not
bytes: an unterminated last record never merges with the next file's first one.
All successful operands contribute to the same widths and cumulative limits.

No operands means stdin. Each path resolves relative to the supplied virtual
cwd; directories fail. Missing/unreadable operands at open produce diagnostics,
continue to later operands, and set status 1. A read/decode/control/budget failure
is fatal before layout publication. Status 0 means no error. Unknown options
return 1 with a diagnostic. The command performs no VFS mutations itself;
redirection is the shell's responsibility.

Shared table-text `Inputs`, `RecordReader`, `Budget`, `settings` and argument
handling are reused without edits. ByteSource fragments are copied by the reader
before another producer pull/finalization. UTF-8 may span chunks. Normal VFS
reads use `readStream`; adapters without it use bounded `readFile(maxBytes =
maxChunkBytes)` and therefore cannot read a larger file in this fallback profile.
The signal reaches VFS calls and shared `readBytes`/`writeBytes` helpers.

Every write is awaited. Output is incrementally emitted only after all input
records are collected, so backpressure is preserved but this is not a streaming
table algorithm. Output/work limit or sink failure during rendering can leave a
prefix already written. No rollback is promised. Sink errors stop subsequent
stdout writes, and failure to write diagnostics propagates. A caller's supplied
abort reason (including errno-shaped reasons) wins over ordinary error handling.

## Display policy: fixed scalar-width profile v1

Decode strict UTF-8; malformed, overlong, surrogate and incomplete sequences
fail. A UTF-8 BOM is not stripped: U+FEFF is rejected. There is no replacement
character conversion or util-linux `x<hex>` fallback.

Widths are sums of scalar widths, with these fixed inclusive hexadecimal ranges:

- Width 0: `0300–036F`, `1AB0–1AFF`, `1DC0–1DFF`, `20D0–20FF`,
  `FE00–FE0F`, `FE20–FE2F`, `E0100–E01EF`.
- Width 2: `1100–115F`, `2329–232A`, `2E80–A4CF`, `AC00–D7A3`,
  `F900–FAFF`, `FE10–FE19`, `FE30–FE6F`, `FF01–FF60`, `FFE0–FFE6`,
  `1F300–1FAFF`, `20000–3FFFD`.
- All other permitted scalars: width 1, including ambiguous-width characters.

This deliberately limited, immutable rule table is not a complete Unicode
version, `wcwidth`, grapheme cluster algorithm, terminal emulator or universal
rendering guarantee. Emoji sequences and scripts outside the listed combining
ranges may differ from a terminal. Selected native UTF-8 fixtures do not certify
all Unicode or all locale behavior.

Retained TAB expands to spaces at the next eight-column stop measured from the
start of that cell/entry. Default table delimiter tabs never reach this step.
C0/C1/DEL controls, UTF-16 surrogates in arguments, `200B–200F`, `2028–202E`,
`2060–206F`, and `FEFF` are rejected when retained. ASCII delimiter whitespace
is consumed before cell validation; CR/VT/FF elsewhere are rejected. Input
separator arguments permit TAB but no other control. Output separators allow
printable scalars only. No ANSI sequence recognition or unbounded regexp occurs.

## Bounds and scheduling

Limits accept positive safe integers or `Infinity`. Invalid configuration throws
at factory creation. All resource limits are unlimited by default, including
when column is registered in a Worker shell. Set individual limits to opt in.

| Limit | Default | Scope |
| --- | ---: | --- |
| `maxInputBytes` | unlimited | Cumulative bytes pulled across all files/stdin, including delimiters. |
| `maxOutputBytes` | unlimited | Cumulative stdout bytes, including padding/separators/newlines. |
| `maxDiagnosticBytes` | unlimited | Cumulative stderr diagnostic bytes; independent of stdout. |
| `maxRecordBytes` | unlimited | Per LF-delimited record, excluding LF. |
| `maxChunkBytes` | unlimited | Each producer chunk, also fallback `readFile` cap. |
| `maxRows` | unlimited | All input records, including ignored blank records. |
| `maxCells` | unlimited | Cumulative retained cells, including explicit empty fields. |
| `maxFields` | unlimited | Fields per table row, checked before field allocation. |
| `maxFiles` | unlimited | Operand count, including repeated `-` and failed opens. |
| `maxSteps` | unlimited | Shared reader/layout/scan work budget, not a separate budget per file. |
| `maxArgumentBytes` | unlimited | Sum of argv UTF-8 bytes; argv count also capped at this value. |
| `maxWidth` | unlimited | Each cell's expanded display width and requested fill width. |
| `maxRetainedBytes` | unlimited | Logical retention charge: 64 bytes per field plus 16 per UTF-16 code unit, covering cell bookkeeping and tab expansion before allocation. |

Plain text tables also admit a cumulative output lower bound (row newlines and
UTF-8 separator bytes) before field slices and cell objects are allocated.
Hidden, reordered and JSON tables use the retention limits without that
projection. These bounds apply even when the shell has a smaller stdout cap;
the shell cap does not automatically replace command limits. Hosts can tighten
`maxOutputBytes` in the column plugin for earlier output admission.

The work meter charges reader transitions, decoded record byte lengths,
split/display scans, blank scans, output dispatches, fill traversal and padding
units. It yields to the event loop at least every 128 charged work units between
bounded operations. This is a deterministic work bound, not elapsed CPU time.
It may be reached before the independent byte limit. Output strings are sized
against remaining stdout bytes before encoding; padding is admitted before
`repeat`; cell counts are checked before field slices; widths and counters use
safe bounded arithmetic. Per-record scans/decode and bounded host calls are not
preemptible mid-operation. Arguments, collected input, row/cell objects, expanded
tabs and output fragments consume memory; these are not a precise RSS ceiling.

Table tail padding uses O(maximum actual columns) suffix byte totals and links
that skip zero-output columns, not a rectangular matrix. Totals saturate at
`maxOutputBytes + 1`: saturation is an overflow-safe proof of non-admission,
never a truncated output size. Metadata construction charges work before its
arrays are populated and while traversing columns. Each short row looks up its
suffix in constant time, admits its complete byte length against remaining
stdout and charges those bytes as cumulative work **before** encoding/copying
padding. Zero-byte suffixes return immediately, including empty separators and
all-zero-width absent columns. Actual fields still consume the original row/cell
limits; absent fields do not become stored cells. Emission traverses only
positive-output suffix segments, so repeated suffix work is bounded by admitted
output bytes, not unchecked rows times maximum columns.

stdout writes are at most 8,192 bytes and awaited; a multibyte sequence may span
ByteIO chunks without changing the concatenated UTF-8 bytes. Already written
buffers are not reused for mutation. Padding repeats are chunk-bounded. Each
output chunk also charges an output-dispatch work step, so work thresholds can
be reached sooner than in the old omission/unbounded-write-size profile. A tail
admission failure preserves any already emitted actual cells but emits none of
that tail. A later newline, sink, cancellation or dispatch-budget failure may
leave an admitted tail prefix. Limits, API, fill layout, scalar-width policy and
resource-cleanup/forwarding contracts are unchanged.

stderr diagnostics are separate from `maxOutputBytes` and cumulatively bounded
by `maxDiagnosticBytes`. Oversized diagnostics include a truncation marker when
space permits; exhausted stderr budget suppresses further diagnostics, not error
statuses. Normal diagnostics retain the filesystem message/path. Diagnostic
encoding only sees a bounded prefix of trusted host-provided error text.

## Cleanup and trust boundary

Column-local cleanup is registered synchronously before resource admission.
The same idempotent promise is used by registration and `finally`. It closes
admission, aborts internal work, covers pending opens, and awaits cooperative
returns of iterators column actually acquired. The wrapper observes late
rejections of cancelled opaque reads/stat/sinks without waiting forever for
that opaque work. Direct hosts may omit `registerCleanup`; `finally` remains.
An uncooperative registered iterator `return()` can still delay settlement;
JavaScript host work cannot be forcibly stopped.

**Existing external-stdin boundary:** `ShellInput` exposes an iterator with
`next()` but no `return()`. Therefore column cannot own/await the underlying
external `Shell.exec({ stdin })` source's hidden return. In the recorded probe,
Shell exec/dispose settled before that external return gate released. Direct
CommandContext sources and column-owned VFS readStream cleanup are tested,
including actual Shell disposal; this does not certify hidden Shell-owned
external stdin. No out-of-scope core fix or guarantee is implied.

## Authorities and evidence

- util-linux manual: <https://man7.org/linux/man-pages/man1/column.1.html>,
  observed manual revision `2.43.devel-739-eee2e` dated 2026-05-24. It documents
  modes, separators, output width, invalid-sequence escaping and the post-2.23
  non-greedy `-s` change. These inform the profile, not universal parity.
- Primary util-linux source repository:
  <https://kernel.googlesource.com/pub/scm/utils/util-linux/util-linux>.
  Inspected `refs/tags/v2.41/text-utils/column.c`; decoded source SHA-256
  `0f9bd01e34be5e3a4b1217c2d70bc0e6643dea6c6364b45e2d045374e9b6b7b7`.
  Fixed eight-column tab stops and fill algorithms were inspected. This source
  was not compiled or used as an executable oracle; no util-linux runtime claim.
- Native oracle: installed `/usr/bin/column`, Apple/Darwin BSD profile, macOS
  26.4.1 build 25E253, Darwin 25.4.0 arm64. Binary SHA-256
  `c6d7b469d8e8437c7185bedd356626ca69867c9c6b002cbb0020d995a6e4cc5f`.
  It rejects `-V`; raw version probe and local man hash are in `native.json`.
  No GNU assumption, package installation or downloaded executable is involved.
- Primary Apple source reference:
  <https://github.com/apple-oss-distributions/text_cmds/blob/main/column/column.c>.
  This moving source reference does not authenticate the installed binary;
  the captured binary hash does. The local man describes a 2048-byte line limit
  and has historically reversed fill-direction prose; behavior comes from raw
  pinned execution, not that wording.

`tests/commands/column/native.json` preserves 28 raw native invocations, locale,
argv, stdin/file bytes, exit status and stderr/stdout hex. `cases.json` is the
unchanged original canonical fixture cohort; `qualifications.json` preserves two
failed exact assumptions and explicitly corrects their classification. Historical
author cohort: **15 exact bytes/status/stderr**, **9 qualified divergences**, **2 options
unsupported by the BSD oracle**, **2 unsupported product features**. None of the
latter 13 is counted as a native parity pass. In particular BSD rejects short
unterminated records as “line too long”; this implementation preserves them.
Original author harness/type mistakes and external-stdin boundary are recorded
in `author-corrections.json`, not silently discarded.

The padding evolution has its own additive records and profile deltas under
`tests/commands/column/padding-evolution/`. Its selected **14/14** exact native
cases use the previously built, identity-checked util-linux **2.41.2 on Darwin**
binary (`a599976edf85eaa3222ac745309596023b5e63283a8b8ee3c3834d741214dd88`).
N01/N03 argv, input and raw native bytes are checked against the immutable
`column-stress` recipes/captures. No fresh native install/build or giant native
probe occurs. This does not certify GNU/Linux locale behavior or full util-linux
parity. The historical stress **37/40** remains attached to its old snapshot;
it is neither rerun nor relabeled here. One prospective author BSD case,
`ragged-table`, now intentionally differs: its current selection is **14 exact,
10 qualified**, with the same 2 native-unsupported and 2 product-unsupported
cases. Original `cases.json`, native captures and historical reports are intact.

Always-runnable regressions require only normal repository development tools:

```sh
node --import tsx --test tests/commands/column/*.test.ts tests/commands/column/padding-evolution/*.test.ts
node tests/commands/column/capture-native.mjs --verify
```

The first replays raw recorded expectations on any supported host; the second
requires the exact pinned native binary and fails on absence/hash mismatch.
Capturing without `--verify` uses exclusive creation and refuses to overwrite
the cohort. Scratch directories are isolated under the owned test directory;
only explicitly created fixture files and their now-empty directory are removed.
No whole-repository gate, deployed-provider certification, performance claim,
packed public-consumer approval or superiority claim is made. A different
verifier must freeze holdouts and check packed standalone behavior before any
public/root integration.
