# XAN 0.54.0: bounded CSV kernel and four-command design

**Selector clarification v4:** `design-evidence/SELECTOR-POLICY-V4.md` records
seven newly ratified project boundaries and the complete proposed selector
grammar. Only its remaining selector exclusion disposition awaits root/Dirac.
It supersedes conflicting grammar proposal labels below and in historical v3;
v3 CR/BOM/EOF/L0, all 18 caps and fallback remain approved unchanged.

**Final policy v3:** `design-evidence/PROFILE-V3.md` and
`design-evidence/BYTE-TABLE-V3.md` supersede conflicting v2 policy below.
Accepted v2 bytes remain recoverable at b9ce9e61115c7d99dfa6a76591b3dcfdaee9ce21.
PROFILE-V2, BYTE-TABLE-V2, HANDOFF-V2, REVIEW-BINDING-V2, LOCAL-BINDING and
RECEIPT are historical, byte-preserved records, not current dispositions.
Root routes Dirac independently; no reviewer acceptance is claimed.

**Historical refinement v2:** `design-evidence/PROFILE-V2.md` and
`design-evidence/BYTE-TABLE-V2.md` supplied the historical root-decision disposition,
exact compact byte table and inspected I/O binding. Original v1 at commit
`91bcc1c9ec64e8e0bdb5db3055ee4c8609cd27a2` has DESIGN SHA256
`8e27ec025c8277cf4fe422d19f9582c2a1b0ab9f9a5577200a1e449703b11c75`;
its original receipt/probes remain immutable. Explicit supersessions below are
not retrospective corrections to native observations. No implementation approved.

**DESIGN ONLY — not implemented, registered, exported or accepted.** Author leaf,
August 28 assignment; actual UTC capture date 2026-08-28. Root must resolve the
remaining grammar questions, then route **Dirac** for independent freeze before
implementation. TEMP expr remains held. No timeout/which/pushd/yq work is included.

## 1. Authority, evidence and stage boundary

The sole upstream target is `medialab/xan` tag `0.54.0`, resolved by the official
GitHub tag API to `2f9156c8ec79a3ecc09e0879735ac68ec8997b7a`. Primary file URL,
SHA256, byte count and access date are in
`tests/commands/xan-oracle-prep-20260828/provenance.json` (repository-relative).

Cargo.toml declares `Unlicense OR MIT`; exact upstream LICENSE-MIT and UNLICENSE,
plus relevant dependency notices, are retained in that directory's
LICENSE-NOTICES.md. The design calls for independent behavior implementation,
not copied Rust code. No parser/runtime dependencies are proposed. Do not infer
license terms from names or from a release binary's presence.

The lockfile, not the manifest's semver minimum, binds `csv 1.4.0`,
`csv-core 0.1.13`, `simd-csv 0.9.0`, and `docopt 1.1.1`. Verified official crate
archive SHA256 values equal their Cargo.lock checksums. Their Cargo metadata
declares Unlicense/MIT, Unlicense/MIT, MIT, and Unlicense/MIT respectively.
`headers` uses rust-csv's Unicode header reader; `count` uses SIMD splitting;
non-expression `select` uses SIMD zero-copy records; `slice` uses SIMD decoded
records. A strict RFC parser, or one uniform rust-csv emulation, is **not** the
pinned implementation. Source locators and a reading map are in design-evidence.

The author ran exactly 28 precommitted developer probes (including version and
four helps), not a product comparison. Protocol commit
`4e2e582847bc3438f3092f963db05d12fc3bc6c5` precedes the first native execution;
execution evidence commit `4628da20` retains all observations. This does not
qualify Linux, service interoperability, performance or independent acceptance.
The old `xan-positive` comparator is genuine but very limited; it was not rerun.

Stage K comprises the bounded streaming CSV kernel, selector parser, and only
`headers`, `count`, `select`, `slice`. Stage S may consider sort/frequency/JSON
**only after kernel review and new scope approval**. Expressions, evaluation
files, regex selectors, shell/native fallback, implicit host files, network,
compression and ambient configuration are absent. This is not full xan support.

## 2. Proposed module-local API and file layout

Proposed TypeScript ESM signatures (not existing public APIs):

```text
interface XanCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<XanLimits>;
}
createXanCommand(options?: XanCommandsOptions): CommandDefinition
createXanCommands(options?: XanCommandsOptions): readonly CommandDefinition[]
xanCommands(options?: XanCommandsOptions): VirtualShellPlugin
```

`createXanCommands` returns exactly one definition named `xan`, dispatching the
four subcommands; `h` is a subcommand alias for headers, not a registry command.
Plugin name: `xan-commands`. Construct/validate immutable options before setup;
collision preflight followed by registration with one `replace ?? false` policy.
An invalid known limit throws `RangeError("Invalid xan limit: <name>")` at factory
construction, before registration or I/O. Reject unknown option/limit keys with
TypeError, and reject non-boolean replace. Omitted limits are defaults; an explicit
undefined known limit is invalid. Limits are per invocation, not per file/phase
or a replacement for the shell's own shared execution/output budgets.

Future files, all solely under `src/commands/xan/`:
`index.ts` (factory/plugin/types), `options.ts` (validation), `argv.ts` (dispatch),
`budget.ts` (local accounting), `csv.ts` (incremental scanner/records),
`writer.ts` (byte CSV serialization), `selector.ts` (bounded non-regex grammar),
`io.ts` (VFS/borrowed-input/owned-output lifetimes), and `headers.ts`, `count.ts`,
`select.ts`, `slice.ts`. These names are proposals, not permission to create them.
No package.json, src/index.ts, default inventory, shared contract or runtime edit.

## 3. CLI grammar: actual target versus initial profile

Dispatch requires a known subcommand. Proposed root `--help` lists this bounded
profile, not all upstream commands; no fake upstream `--version` string. Product
version behavior is an integration-owner decision, not proof of native support.
`xan` without a subcommand or an unknown subcommand returns 1 with a bounded usage
diagnostic. Subcommand `-h/--help` is a no-input success and documents unsupported
features explicitly rather than copying upstream help as an availability claim.

Upstream docopt accepts options after positionals; `--` disables option parsing,
including for negative-leading selection strings. Long `--name=value`, attached
short values (`-l2`), and clustered switches are recognized. A value-bearing short
option consumes the remaining token or the next argv item. No option abbreviation
is promised. One literal `-` means stdin/stdout in the relevant operand; no shell
expansion occurs inside the command. Repeated singleton flags are not a
last-one-wins extension: root ratifies rejection before I/O; exact docopt diagnostic
for every repetition is unmeasured, so this is a declared strict grammar boundary.

| Subcommand | Pinned grammar and options | Proposed Stage K |
| --- | --- | --- |
| headers/h | `[options] [<input>...]`; `-j/--just-names`, `--csv`, `-s/--start <n>` default 0, `--color <when>` default auto, `-h`, `-o`, `-d` | All listed, except `--color always` explicitly unsupported; auto/never mean no ANSI |
| count | `[options] [<input>]`; `-p/--parallel`, `-t/--threads <threads>`, `-a/--approx`, `-h`, `-o`, `-n`, `-d` | Exact streaming count, -h/-o/-n/-d; reject parallel/threads/approx before I/O |
| select | `[options] [--] <selection> [<input>]`; `-e/--evaluate`, `-f/--evaluate-file`, `-h`, `-o`, `-n`, `-d` | Shorthand grammar below; reject -e/-f before reading any expression file |
| slice | `[options] [<input>]`; `-s/--start`, `--skip`, `-e/--end`, `-l/--len`, `-i/--index`, `-I/--indices`, `-L/--last`, `-S/--start-condition`, `-E/--end-condition`, `-B/--byte-offset`, `--end-byte`, `--raw`, `-h`, `-o`, `-n`, `-d` | All row-index forms; reject conditions, byte-offset/end-byte/raw before I/O |

There is **no `-n` for headers**. Count has **no --limit** and no sample-size in
this tag. Slice has no `--accumulate` in its inspected Args/usage despite release
prose mentioning a related removal/conflict; source wins over extrapolation.
Headers has no row limit. Do not invent shared flags across subcommands.

No input means caller stdin. Headers permits several files, but at most one `-`;
other commands permit at most one file. Literal files named with a leading dash
require `--`. All paths are virtual, resolved against context.cwd. -o defaults
to stdout and `-o -` also chooses stdout. Explicit filename suffix inference is
case-sensitive: `.tsv`/`.tab` => TAB, `.ssv`/`.scsv` => semicolon, `.psv` => pipe;
otherwise comma. Input -d overrides inference. Output inference is independent:
-d does not select the output delimiter. Reject `.gz`, `.zst`, `.cdx`, `.ndjson`,
`.jsonl`, `.vcf`, `.gtf`, `.gff2`, `.sam`, `.bed` inputs/outputs with a documented
unsupported-format diagnostic rather than pretending to implement their native
compression/tabular adapters. Ordinary extensionless VFS files remain supported.

Delimiter conversion in upstream accepts exactly one ASCII byte or literal `\t`;
Unicode multi-byte delimiters fail, even when one Unicode character. Ratified
Stage K additionally refuses NUL, CR, LF and quote as delimiter (CLI NUL cannot
normally arrive through a shell); native parser behavior for those pathological
delimiters is not qualified. This is a project restriction, not a native golden.

Integer parsing: row/start/end/len/header-start are decimal u64 in this 64-bit
profile; threads is NonZeroUsize upstream. Ratified profile accepts ASCII digits
and optional leading `+`, no spaces, negative sign, decimal point, exponent,
separators or hex. Source qualification found docopt's numeric deserializer
converts an empty or whitespace-only supplied value to **zero** before Rust
FromStr; ratified rejection of that special case is an explicit safety deviation,
not the native grammar. Nonempty numbers with surrounding whitespace fail natively.
Parse
digit-by-digit with bigint/checked integer arithmetic, rejecting >2^64-1 before
Number conversion. Select indices are signed i64 (optional +/-), range checked
against the actual bounded column count before conversion. Quoted numeric selectors
still become numbers upstream. A huge unbracketed token outside i64 instead falls
back to a **name**, whereas bracket indices fail conversion; preserve this
distinction. Checked start+len/index+1/header-start+index overflow is an intentional
safety rejection, not Rust release wrapping compatibility. File cardinality,
required values and required selection are validated before acquiring any stream.

### Headers

Read only the first logical record of each input. Empty input contributes zero
headers. Decode those cells with fatal UTF-8; do not decode body records. Default
index width is max(4, decimalDigits(max(numberOfHeaders-1,0))) across all files;
it does **not** expand for --start. Emit decimal(start+column) right-padded with
spaces to that width, then sanitized header then LF. -j hides the index only.
For multiple files print the input path (or `<stdin>`) then LF before each block,
one empty line between blocks, followed by the native summary below.

Sanitization: remove U+00AD; remove C0 non-ASCII-whitespace controls; render CRLF,
LF, CR, TAB, FF as literal `\r\n`, `\n`, `\r`, `\t`, `\f`. Highlight leading/trailing
Unicode whitespace with one `·` per **UTF-8 byte** of that whitespace, even with
colors disabled. Use an explicit pinned Unicode White_Space table, not ambient
locale or JS regex. Other characters, including DEL, are not implicitly stripped.
Header duplicates are compared exactly before sanitization. No ANSI is emitted.

For multi-input summary, tally every occurrence, including duplicates, across
files. If every tally equals file count, append LF then
`All files have the same headers!\n`; otherwise append LF then
`All files don't have the same headers!\nDiverging headers: <names>\n`.
Diverging names have tally < file count, sorted by UTF-8 byte order, joined by
`, ` after sanitization. This odd duplicate-sensitive tally is pinned behavior,
not a mathematically corrected set comparison. Row 08 demonstrates it.
`--csv` bypasses display/index/sanitization: write one CSV header of input paths,
then transpose original header cells by column index, padding shorter inputs
with empty cells. -j/-s do not alter that CSV result.

### Count

Return ASCII decimal logical-record count then LF; skip the first record unless
-n. Its help sentence for -n is misleading: row 11 confirms the first row is
**included**. Empty/BOM-only input => `0\n`; header-only => `0\n` or `1\n` with -n.
Count uses a splitter: do not enforce uniform width or UTF-8 validity. It scans
through EOF, with no fabricated early limit flag. Safety row/byte/work limits
cause failure, never a truncated successful count.

### Select

Compile one selection against the first logical record's width and bytes. With
headers, emit selected decoded header cells using normal CSV quoting; -n uses
the first record only as a width template and then emits it as data. Named forms
are forbidden under -n; numeric, all, range and complement still work.

Grammar is a comma-separated list with optional one leading `!` complement.
Empty selection means all; bare `!` means none. `*` means all columns. Inclusive
`start:end` ranges permit omitted start (0) or end (last); descending ranges
reverse order. `:0` is first column, **not** all columns despite the help example.
Negative index -1 means last. Bare name picks its first duplicate; `name[k]`
picks zero-based duplicate occurrence, with negative occurrence counting backward.
Lists preserve order and duplicates. Complement returns unselected columns in
original order, once each, not reversed or repeated.

Names compare selector UTF-8 bytes to unescaped header bytes without case-folding,
normalization or locale. No header-wide decode is needed for index/named/wildcard
selection: invalid UTF-8 headers can coexist with valid UTF-8 selected names.
argv must be valid scalar-value text (reject lone JS surrogates rather than let
TextEncoder silently replace them). Prefix `name*` and suffix `*name` use literal
byte startsWith/endsWith only, not glob/regex evaluation; no matches is an error.
Interior `*` is literal under the pinned parser; `*foo*` means suffix `foo*`, not
contains. Unquoted name whitespace is significant. A leading `!` only applies
at the start of the entire selector, not each clause.

Double-quoted selector names allow commas/colons/brackets; an occurrence bracket
can follow a closing quote. Pin surprising source behavior: quoted numeric text
still parses as an index; doubled quotes inside a quoted name are retained as
**two** quote characters, not decoded to one. A quoted bare name ending `*` still
takes the parser's prefix-selection branch. Do not promise quoting fixes every
documented conflict. Whole empty selection and a single trailing comma are valid;
interior empty clauses are ratified pre-I/O refusals. SELECTOR-POLICY-V4 defines
the complete proposed consuming grammar and finite refusal categories, replacing
the vague cursor-skipping exclusion. In particular `0::1` is proposed syntax
failure; `**` is a suffix match and `0:*` has a literal-name range endpoint.
Root/Dirac must dispose of this last selector proposal before independent freeze.

Data emission has two modes. Same-comma data may preserve owned raw lexemes ONLY
when the exact faithful-reparse criterion in PROFILE-V3 holds. Cross-delimiter
output always serializes decoded cells; root approved this explicit native-byte
deviation. Noncomma input also decodes and serializes, unescaping exactly once.
Native raw incomplete quotes (original row 21) and moved-BOM loss (additional 13)
remain evidence, not a safe-copy license. V3 approves closing unterminated EOF
quotes and forcing leading-BOM-cell quoting. CR-containing logical cells must
also be quoted; raw transfer must satisfy writer grammar AND reversibility.
Zero selected cells emit LF; one empty cell emits `""\n`; two emit `,\n`.

### Slice

Default range is [0, unbounded), indexing **data records**, excluding header.
Emit the parsed header once in header mode; an empty
input's zero-column header serializes as LF as specified below. --skip supplies start
only if --start is absent. End is exclusive. -i N means start N, length 1;
it conflicts with start/end/len (including a --skip resolved to start). End and
len conflict; start>end errors. Native start=end and len=0 emit the remainder.
Root chose compatibility over v1's safe-empty proposal: default-start -l0 emits
all records. Additional 01/02/03 and primary range/loop source qualify nonzero
start, equal bounds and zero end separately; PROFILE-V3 gives the exact matrix.
Ordinary zero/equal ranges are not early-read stops. V1's correction is withdrawn.

-I accepts a comma-separated nonempty list of unsigned decimal indices; validate
all tokens, sort and deduplicate under the selector-node/work budgets, then emit
in file order. Upstream ignores ordinary range flags when this branch wins;
-L takes precedence over -I and ordinary range flags despite help saying
incompatible. Ratified profile rejects these mixed modes before I/O instead of
silently honoring native precedence. Common -n/-d/-o remain valid with every mode.
The native -I invalid-index message mistakenly says `-i/--index`; root requires
accurate `-I` identification and nonempty bounded wording, not globally fixed text.

-L N for positive N retains at most N owned decoded records in a bounded ring and emits after
EOF; no seek optimization or filesystem whole-read is required. Both row count
and retained byte limits apply. Reject N>maxLastRows before reading. For N=0,
v3 requires NO DATA ROWS uniformly for stdin and every VFS file, header only
when enabled. With -n no input iterator/read is taken. This deliberately differs
from additional 04 native stdin final-row output; no seekability rule is inferred
from additional 05 native file evidence. See PROFILE-V3. Ordinary slice serializes decoded
cells using minimal necessary quoting and LF; it does not preserve redundant
input quotes. Early finite ranges stop at the last requested logical record.

## 4. Bytes, parser dialect and serialization

One incremental module can share byte scanning/storage machinery but must carry
an explicit command dialect, not conflate these semantics:

| Input feature | headers / rust-csv | count/select/slice / SIMD target |
| --- | --- | --- |
| BOM | strip EF BB BF only at absolute byte zero | same intent; BOM-only is empty (count observed) |
| LF, CRLF | record terminators | LF terminates outside quotes; CR directly before LF is removed from raw/decoded records |
| lone CR | terminator outside quotes | skipped at a fresh record start; interior CR is content, not a separator (count observed) |
| blank lines | ignored, not one empty-field row | fresh-record CR/LF skipped; whitespace-only line is a real record |
| empty/trailing fields | preserve each field, including after trailing delimiter | same for ordinary CSV |
| multiline/doubled quote | quoted newlines preserved; doubled quote decodes once | same ordinary case, raw select retains original quote bytes |
| whitespace | no trim | no trim; display sanitization is separate |
| UTF-8 | fatal only for header display/--csv | values/header bytes preserved without whole-record decoding |
| ragged width | header-only reader never validates unread body | count accepts; select/slice reject mismatch with first-record width |
| unterminated quoted EOF | permissive rust-csv completion, not RFC error | native raw select preserves incomplete quote; v3 approved repair via decoded writer (PROJECT PROFILE) |

Empty input has no logical record; `""` is one record with one empty cell; `,`
is one record with two empty cells. Header-only files have no data unless -n.
The source-only empty-input output matrix is explicit: headers text => no bytes;
headers --csv with omitted input => `<stdin>\n`; count => `0\n`; select `*` or
empty selection => LF in header mode, no bytes with -n; slice => LF in header
mode, no bytes with -n. The zero-column synthetic header is a writer behavior,
not a counted input record. Numeric selection on empty input is out of bounds.
These empty select/slice outputs were not separately executed in the 28 rows.
An empty header name from `""` is instead a real one-column header, not zero columns.
At EOF without LF, raw SIMD selection retains a trailing lone CR; decoded SIMD
record finalization removes its final CR byte. This source-level distinction is
not a license to normalize all CR bytes or all commands alike.
Each file has its own BOM-at-zero state; BOM elsewhere is literal data. Preserve
partial BOM prefixes across chunks before deciding, without dropping partial
EF/EF-BB at EOF. Both dependency implementations inspect the initial available
buffer for the BOM, and csv-core explicitly documents a split-BOM limitation;
chunk-invariant BOM handling here is a deliberate improvement, not a measured
native all-chunk guarantee. Count does not allocate cell payloads but still charges columns,
record/cell byte ceilings as it scans (a safety cap, not width validation).

Rust-csv is permissive: quote characters in unquoted fields are literal and
post-quote unquoted text can continue a field. SIMD quote detection can enter
quoted state even after unquoted text; raw and decoded paths can disagree.
The inspected SIMD core also has lookahead-sensitive CR branches. **Do not
reproduce unsafe indexing or buffer-boundary artifacts.** Proposed initial
supported malformed subset is EOF while quoted, blank lines and ragged count;
headers retains rust-csv permissiveness for first-record quote placement.
Select/slice reject quotes embedded in an unquoted field or nonseparator text
after a closing quote with `xan <subcommand>: unsupported malformed CSV quoting\n`.
Count still follows quote-state splitting without asserting RFC validity.
That asymmetric bounded profile is explicit, not a full-malformed-input claim.
Root approves this bounded dialect in v3; broader malformed equivalence remains
unmeasured, not native proof.

Normal writer quotes a cell if it contains output delimiter, quote, CR or LF;
double every quote byte, surround with quotes. No quoting solely for spaces,
Unicode or invalid UTF-8. Single-empty-cell rows are quoted, zero cells emit LF;
all output line terminators are LF, not host native newlines. V3 approves quoting a first output cell beginning EFBBBF at absolute output zero to preserve
its value. Raw-select mode requires v3 writer grammar AND faithful reparsing. Header display
is text; header --csv uses original decoded cells. No ambient locale, terminal
width, color environment or untrusted main-thread RegExp/JS evaluation is used.

## 5. Streaming state, ownership and stop rules

Scanner state comprises absolute byte offset, logical record index, field index,
dialect, first-byte BOM prefix, record-start, field-start, unquoted, quoted,
after-quote and pending-CR state. Cursor advancement and quote-pair decisions
must work when every byte arrives separately. A physical newline inside quotes
does not end a record. Keep raw field spans only where raw selection needs them;
decoded material is built in bounded segments, never by repeated quadratic
concatenation. Store one current record, one header/template, selection indices,
and optional bounded tail ring. Multiple headers retain at most the aggregate
input-file/header budget. No full-input buffer and no reuse of the table-text
line reader as a CSV parser.

Stop admission before requesting the next source chunk when the required final
record is already known. Headers stops after its first record, finite slice and
-I after the highest needed index. Ordinary zero/equal ranges read through EOF.
V3 -L0 needs only a header for every source, or no input with -n. No body
parse/tail ring; existing validation, -o alias preflight and cleanup still apply.
Ordinary zero/equal ranges are not affected by this zero-tail stop.
Do not issue an extra next() merely to discover EOF. Already received chunks may
contain unneeded following bytes: acquisition/read-ahead cannot be rolled back.
Charge the whole delivered chunk to input bytes/chunks, but do not parse beyond
the stopping cursor or diagnose unused later malformed records. No provider read
buffer size guarantee is inferred from chunkSize hints.

Inspect/reuse the existing contracts, not obsolete TEMP hooks:
`src/contracts/io.ts` (readBytes/writeBytes/abortable), `output.ts`
(createOutputOperation/ownedOutput), `command.ts` and command.md
(registerCleanup), filesystem.ts/filesystem.md, contracts/path.ts, and
`src/commands/copy-identity.ts` (compareObservedEntries).

The supplied stdin is **borrowed**, even when it happens to be a pipeline reader.
The current readBytes helper calls iterator.return() on early exit. Therefore
wrap borrowed stdin with a local forwarding iterable whose iterator has next()
but **no return()/throw()**, then pass that wrapper through readBytes(signal).
Do not use for-await directly over the original borrowed iterator and do not
cancel/return it. Do not take an iterator at all when no input is needed. Preserve
stdinIsDefault; EOF or empty bytes do not prove default provenance. This command
does not invoke children or need a private context/global pipeline controller.

For owned VFS reads, create an invocation-local close/admission scope and register
its idempotent cleanup synchronously **before** readStream, iterator creation or
output acquisition. Register the same close promise in context.registerCleanup
when provided and await it from finally; direct custom hosts may omit the hook.
Closing prevents new acquisitions; admitted cooperative resources must either
publish into the live scope or be released on late completion. Concurrent close
calls share completion; drain all cooperative callbacks even if one fails.

Use readBytes/writeBytes with the supplied appropriate signal. Copy every
retained borrowed fragment into owned Uint8Array storage **before** another
next()/producer-finalization; Buffer.slice/subarray do not copy. A transient
write may use a view only until its awaited sink write completes and before
advancing/finalizing the producer. Header/ring/raw-spanning-record storage is
owned. No lease or arbitrary concurrent producer mutation guarantee is invented.

Create the destination-specific output operation before its resource acquisition.
Use `operation.acquire` only for known cooperative owned resources: the inspected
helper drains admitted acquisition promises and is not an arbitrary-host timeout
primitive. Pass signal through stat/read/write/identity calls. For opaque host
promises, use abortable observation and retain rejection handlers; do not enroll
them as cooperative cleanup or wait forever solely to claim all effects stopped.
FileSystem has no universal cooperative-stream capability. Existing adapter
behavior must be inspected during implementation; if an acquisition/return has
no truthful cooperative contract, report that limitation and do not claim a
resource-drain guarantee. No new shared hook is authorized to disguise this gap.

stdout ownedOutput enrolls **that destination** only. An -o file operation is
rooted separately in context.signal, not as stdout's child; stderr is independent.
Closing stdout must not cancel file output, stderr or the entire command context.
Do not create a fake sink wrapper and claim it owns sibling streams. Children
exist only for explicitly owned scopes. Already-closed enrolled output can stop
admission before the first read; an unenrolled opaque sink cannot be probed with
empty writes or promised preemptible.

Caller cancellation propagates its exact reason, even errno-shaped, before
execution/control failure, before local output-close cancellation. Preserve
escaping host failures; never infer cancellation from reason equality, Error
name or status 1. Real native EPIPE maps to 0 upstream; virtual early-pipe/pipefail
selection belongs to existing runtime provenance rules, not a blanket local
catch-and-success. Native signals do not define virtual AbortSignal status.
Stat/I/O errors report a human-readable command diagnostic for typed expected
FsError and return 1; cancellation and escaping execution errors are rethrown.
Do not serialize errno strings as the diagnostic contract. Cleanup rejection
selection remains exactly command.md's caller/error/cleanup precedence.

## 6. Approved accounting defaults and validation

All 18 defaults and all 18 hard ceilings are **root-approved logical caps**
in v3. Exact values are unchanged from v2; the prior prose count of 19 was an
error, not an extra limit. No quota bypass or RSS guarantee is granted.
Host overrides must be positive safe integers <= the approved hard ceiling;
parent budgets always win and no CLI flag resets limits.
KiB/MiB/GiB are powers of 1024. Counters start once per invocation, including
headers across files, selector parse/resolve and output; no per-phase reset.

| XanLimits field | Default | Approved hard ceiling |
| --- | ---: | ---: |
| maxArgs | 128 | 4096 |
| maxArgumentBytes | 64 KiB | 1 MiB |
| maxInputFiles | 16 | 256 |
| maxInputBytes | 256 MiB | 4 GiB |
| maxChunks | 262144 | 4194304 |
| maxChunkBytes | 8 MiB | 64 MiB |
| maxRecordBytes | 8 MiB | 64 MiB |
| maxCellBytes | 4 MiB | 32 MiB |
| maxColumns | 16384 | 65536 |
| maxRecords | 1000000 | 16000000 |
| maxSelectorBytes | 16 KiB | 256 KiB |
| maxSelectorNodes | 4096 | 65536 |
| maxSelectorDepth | 2 | 2 |
| maxSelectedColumns | 16384 | 65536 |
| maxLastRows | 4096 | 65536 |
| maxWork | 1000000000 | 16000000000 |
| maxOutputBytes | 256 MiB | 4 GiB |
| maxRetainedBytes | 32 MiB | 256 MiB |

maxArgs includes subcommand/options/operands, not the registry name. Argument
UTF-8 size is computed by a scalar scan before encoding; reject surrogates.
Input bytes count every received chunk including read-ahead and BOM; chunks count
empty deliveries too. Record bytes count raw syntax excluding the final record
terminator, but including embedded newlines/quotes/delimiters; cell bytes count
raw field syntax excluding separators. Columns include empty trailing cells.
Records include every nonblank logical record, headers/templates and skipped
records, not only emitted rows; maxRecords is aggregate across header inputs.

Selector bytes include original UTF-8; nodes count each list clause, endpoint,
occurrence and complement wrapper before allocation. Depth counts list=1 and
its clause=2; endpoint/occurrence are iterative fields, no nested grammar.
Selected-column limit applies to materialized output positions including
duplicates. -I tokens use the same selector byte/node/work budgets. maxLastRows
bounds both request and occupied ring; retained bytes can fail first.

Work is deterministic: one unit per inspected input/argument/selector byte,
one per compared byte in name/prefix/suffix lookup or sort, one per emitted
index, one per copied/decoded/encoded/output byte. Charge repeated inspections
again. Check cancellation at least every 4096 work units and every awaited I/O;
yield cooperatively after 65536 units without resetting any counter. This is
logical work, not a wall-clock or instruction-count guarantee.

Retained bytes are logical owned live storage: exact buffer capacities, decoded
string upper bounds (2 bytes per UTF-16 unit), 8 bytes per retained numeric index,
and 32 bytes per node/span/ring entry, including scratch and output staging.
Count metadata capacities, not only payload lengths. Pre-admit source-span copies,
new tokens, decoded strings, index expansion and concatenation **before allocation**;
when replacing a buffer, charge old and new simultaneously until old is released.
The borrowed incoming chunk's full length is separately admitted by maxChunkBytes;
do not claim it was allocated by this module. Total input/rows/work/output counters
never decrement; live retained occupancy may decrement only on actual release.
No logical counter is advertised as RSS/heap/provider allocation.

Before each sink write reserve exact encoded bytes; count stdout, stderr and file
output together, including CSV syntax. A limit failure has status 1 and proposed
message `xan <subcommand>: <limitName> limit exceeded\n`, only if remaining output
budget can fit the **entire** diagnostic; otherwise emit nothing further. No
out-of-budget emergency write or success after truncation. Header/selector errors
may already have partial output in native; proposed prevalidation can avoid some
effects but does not roll back earlier writes. Numeric values remain bigint until
proved bounded; safety limits are not floating-point rounding licenses.

## 7. VFS output and nontransactional publication

No fs builtin/host path, native process or hidden temp file. Prefer fs.readStream
with the signal. For providers lacking readStream, Stage K streaming input is
unsupported (ENOTSUP), rather than quietly reading the entire input via readFile.
Existing ordinary memory/real adapters must be checked by the implementation
owner. stdout works independently of VFS streaming-write support.

For -o use the precise PROFILE-V3 existing-contract composition: identity
preflight, required-header/selection validation, then fs.writeStream with owned
bounded ByteSource and signal, wx for missing or w for observed distinct existing.
The old writeFile(empty)+append speculation is withdrawn. V3 approves a bounded
whole-result writeFile fallback with the SAME flag when writeStream is absent,
admitting simultaneous buffers under retained, output and parent budgets before
publication. Actual conditional wx is required for new paths; unsupported
capability refuses. No new capability gate, permission fallback or append
sequence. Provider storage is not module retained memory.
Later body parse/cancellation/write failure can leave partial/truncated output;
there is no rollback or observation-to-open atomicity claim.

Before acquiring any potentially eager input or destructive output, resolve all
file paths and stat/identity observations with context.signal. Reject same
normalized input/output path; observe realpath aliases but do not treat lexical
containment/different paths as authority. Existing output versus every file input
must be distinct under complete scoped identity or compareObservedEntries;
same => EINVAL, unknown => ENOTSUP, contradictory authority => EIO, preserving
source bytes and destination. Do not fabricate scopes or compare bare inodes.
Missing output uses actual exclusive `wx` creation; a raced creator fails without
truncation. Existing distinct output uses w; external rename/ABA/path changes
remain TOCTOU because identity observations are neither leases nor transactions.

Borrowed stdin may itself be backed by the output file and has no path identity.
Common `... | xan select ... -o new.csv` is still allowed using exclusive creation
when missing. Proposed policy: refuse an **existing** -o destination when reading
borrowed stdin, because distinctness cannot be proven; don't silently refuse all
-o forms. Multiple headers with one stdin follow the same rule. Document this
specific safety deviation. Host/provider guarantees could enable future guarded
overwrite, but no such contract is invented now.

Permissions follow the chosen VFS. V2 omits explicit mode (WebDAV rejects it);
backend defaults apply, not a universal 0o666 request. Existing modes remain
provider-defined. permissions:false is not
a privacy guarantee. Do not chmod, create missing parent directories, delete a
partial destination, or remove a temporary path on failure. Native -o behavior
is evidence only for separate owned temp files, not safe alias handling.

## 8. Exact diagnostics and freeze decisions

Observed raw stderr/status bytes in RESULTS.json are authoritative for its rows.
Examples: missing selection and unknown headers -n both return 1 with usage;
u64 overflow returns exactly
`Could not deserialize '18446744073709551616' to u64 for '--start'.\n`.
Ragged row 20 emits `a,b\n` before
`xan select: CSV error: record 2 (byte: 4): found record with 1 fields, but the previous record has 2 fields\n`.
Header invalid UTF-8 is separately captured with record/line/field/byte context.
Native record-position offsets must not be invented from physical line counts.

Source-known selector messages include `Prefix '<prefix>' selected nothing.`,
`Suffix '<suffix>' selected nothing.`,
`Unclosed quote, missing closing ".`,
`Unclosed index bracket, missing closing ].`,
and `Selector name '<name>' does not exist as a named header in the given CSV data.`
Native prefixes these operational messages with `xan <subcommand>: ` and LF.
Positive out-of-range wording prints upper bound equal to field count (not N-1);
do not silently fix text while claiming exact diagnostic parity. Malformed argv
help/usage formatting and all filesystem OS messages are not fully qualified;
Stage K proposed unsupported forms use
`xan <subcommand>: unsupported in bounded CSV profile: <option-or-feature>\n`,
status 1. Unknown/missing argument diagnostics require independent freeze, not a
blanket relaxed assertion. No numeric native errno serialization is proposed.

Root disposition **v3 before Dirac independent fixture freeze** supersedes the
v2 decision list. PROFILE-V3 and BYTE-TABLE-V3 are the current normative delta;
original 28+16 observations and historical receipts remain byte-preserved.

1. Preserve ordinary -l0/start/end-zero compatibility; -L0 uniformly emits no
   data, with headers only when enabled, independent of stdin/VFS kind.
2. Approve per-command CR/BOM/count-versus-parser dialects, M refusals and
   valid EOF repair; source-inferred/unmeasured rows remain PROJECT PROFILE.
3. Approve faithful serialization: quote CR-containing cells and moved first
   BOM data. Same-comma raw must be writer-valid AND reversible.
4. Approve all 18 unchanged defaults/hard ceilings; parent budgets always win.
   SELECTOR-POLICY-V4 records seven subsequent ratifications; only its precise
   selector exclusion proposal remains pending. No new command breadth is added.
5. Approve bounded whole-result writeFile fallback under existing wx/w and
   alias rules, not append emulation or atomic identity-conditioned open.
6. Advanced flags/formats/color/expressions remain rejected. Root must route
   Dirac separately; neither implementation nor independent acceptance exists.

Future freeze coverage must include every chunk split/BOM/CRLF/escaped-quote
boundary, reused Buffer producer/finalizer mutation, Unicode display/selector
quirks, empty/zero-column/ragged/unterminated cases, integer extremes, bad argv,
per-limit first-over-bound and combined-phase accounting, early-read poison
sources, output-close provenance, concurrent cleanup, late cooperative acquisition,
opaque losing promises, VFS same/hardlink/symlink/unknown identities, partial -o
effects, and actual Shell/registry pipelines. These are **requirements for later
work**, not tests implemented or acceptance already achieved. No shared prerequisite
change is currently authorized; any genuine missing shared contract must be
reported to root before a source patch. Build/strict-consumer evidence comes only
after implementation and integration-owner approval.
