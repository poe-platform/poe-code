# Frozen tree/file safety and harness peer review

Static review of tree `e2d1b9230f4304650651572395523ca9d1644e74`, file
`d168d18b118592e04a6eec9b00eb50cc2b1e5058`, and SQLite correction
`9f7fed68077a68ef3decb114ace83ad47b75ae14`. Line numbers below refer to those
frozen versions, not a later author's working tree. No product/native oracle
execution, author-source edit, shared executor/lifecycle/root/FS change, staging,
or commit was performed. Only builtins-based evidence reads and four finite
harness mock observations ran. Source findings are static, not measured attacks.

## Source verdict: HOLD for cumulative-work acceptance

No attacker-compiled RegExp exists in either product family. The eleven direct
constant regex sites have simple finite or linear shapes; this review did not
identify catastrophic regex backtracking in the inspected source. That does
**not** establish cumulative safety: the following gaps remain.

### TREE-WORK-001: empty alternative initialization is uncharged

`src/commands/tree/pattern.ts:40`: every alternative allocates and zeroes a
`Uint8Array(name.length + 1)` before reaching `budget.step` inside its token loop.
`compile` preserves empty alternatives. A pipe-only pattern therefore allocates
one row per alternative per nonempty entry and charges no matcher steps at all.
`-I` applies it before sorting; `-P` applies it to nondirectory children after
inspection. Both reuse the same invocation budget, but this work never enters it.

For 4095 pipes, 128 distinct 512-byte names, initialization alone requests
4096 × 128 × 513 = 268,959,744 bytes of cumulative allocation. This is NOT peak
memory, a runtime measurement, or permission to execute this large example.
Argument and metadata limits admit the inputs but do not charge this product of
dimensions against `maxSteps`. Synchronous empty-alternative loops also lack
cancellation checks. This is a finite-DP accounting defect, not regex backtracking.

Root was notified before any source edit in
`/tmp/safe-bash-inspection-safety-peer-root-route.txt`. Authors should account
before proportional initialization, or normalize empty alternatives without
changing empty-name semantics; skip work rather than merely rename its budget.
Keep a shared invocation budget across patterns and entries. A static proof of
normalization is acceptable; do not require a now-eliminated workload to fail.

### TREE-WORK-002: sorting is bounded but incompletely work-metered

`tree.ts:93` charges one step per `Buffer.compare`, not compared bytes. Long
common prefixes increase work within each charged comparison. Existing per-name
16-KiB, per-directory 10,000-entry and cumulative 8-MiB metadata limits provide
finite bounds; this is not an unbounded-engine claim. `tree.ts:107` performs
the second `--dirsfirst` sort with **no step or signal checks** in its comparator.
The new cumulative-work requirement needs an explicit accounting policy covering
both passes, including byte comparison cost; do not silently treat a comparison
as an arbitrary-sized constant operation. Sorting must preserve output ordering.

### TEXT-BOUND-001: backend text transforms precede bounds

File `index.ts:93-94` passes unrestricted `readlink` target text into
`escapeName`; `shared.ts:119-128` also transforms unrestricted backend error
messages. Neither target nor diagnostic bytes enter `maxInputBytes`/`maxSteps`.
`output` encodes the already-built escaped string before its output cap check;
`failure` encodes all text before slicing. A huge control-heavy target/message
can therefore cause an unbounded command-side scan and expanded intermediate
allocation before rejection/truncation. Even MIME-only output first constructs
the unused symlink description. The character-class regex itself is linear.

Tree is stronger for ordinary names/targets: `WalkBudget.text` limits individual
and cumulative metadata before escaping them. However, `io.ts:13-14` strips an
errno prefix from arbitrary backend `Error.message` before `tree.ts:115` admits
the resulting error text. This initial regex scan is not bounded by that later
check. Root should request finite preflight text admission and incremental
bounded escaping where needed, using family-owned limits/policy, not FS changes.
Provider allocation and arbitrary host JS remain outside consumer control; this
finding concerns additional command-owned processing after the host returns.

## Complete direct regex/parser/header inventory

### Tree

| Path | Input and bound | Static assessment |
| --- | --- | --- |
| `arguments.ts:29`, `/[\ud800-\udfff]/u` | All arguments admitted under 4096 fields/65536 UTF-8 bytes | Single class scan; no nested repetition |
| `arguments.ts:69`, `/^[0-9]+$/u` plus `Number` | `-L` argument within same byte cap | Anchored digit scan, linear backoff on failure; numeric safe-integer/depth validation |
| `io.ts:14`, `/^[A-Z][A-Z0-9]+: /u` | Backend error message before metadata admission | Anchored linear greedy prefix; TEXT-BOUND-001 |
| `tree.ts:22`, `/[\u007f-\u009f\u2028\u2029\p{Cf}]/gu` | `JSON.stringify` of a small product-created record of admitted text and fixed fields | Single-codepoint replacement; callback splits at most one Unicode code point into UTF-16 units |
| `tree.ts:84`, `/[\ud800-\udfff]/u` | Entry names after per-name/cumulative metadata checks | Single class scan |
| `tree.ts:99`, `/\/$/u` | Previously admitted display path | One trailing-slash match; no nested repetition |
| `arguments.ts:23-82` | CLI loops, attached flags, `toUpperCase`, substrings | Aggregate argv cap precedes parse; compile/parse do not consume `maxSteps` but are finite in capped input |
| `pattern.ts:6-35` | UTF-8 byte glob compiler; `*`, `?`, bracket ranges, escapes, pipe alternatives | Finite forward scan; rejects path/globstar/malformed ranges; never builds a regex |
| `pattern.ts:40-62` | DP rows for each alternative/name, bracket `some` | Token × name charge precedes each token row; range count charged before scan; empty-alternative gap above |
| `tree.ts:76-107` | Entry validation/Set uniqueness/hidden/exclude/include filters and two sorts | Raw listing count and metadata charge include filtered entries; pattern budget shared; sorting gap above |
| `io.ts:17-24`, `tree.ts:111-174` | Text escaping, prefixes, JSON stringify, report counters | Finite scans/constant-shape records after metadata checks; no JSON parse or arbitrary recursive object serializer; output bytes capped before writes, but strings already built |

WalkBudget is allocated once at command entry. `entry` counts root operands and
all returned entries; `text` repeatedly charges names/paths/display/targets/errors.
FS operations, ancestor comparisons, listing iterations, first-sort comparisons
and nonempty DP cells share `steps`. No per-entry reset exists. `fs` yields every
64 operations, races abort, observes late promise rejection, and removes listeners
in `finally`. DP and sorting are synchronous between such boundaries. Output uses
awaited `writeBytes` with owned chunks of at most 16 KiB; stdout/stderr share cap.
Readdir materializes its array before the consumer can check its length; this is
already documented, not proof of bounded provider memory. Depth is capped at256.

Read-only dependency trace: `resolvePath` validates NUL/type then delegates to
Node POSIX path resolution; it adds no user regex. `compareObservedEntries`
uses finite identity/provider comparisons with signal forwarding; the tree
charges its ancestor calls. No identity, FS or path helper edits are requested.

### File, unchanged safety paths across SQLite correction

| Path | Input and bound | Static assessment |
| --- | --- | --- |
| `classify.ts:34`, `/^%PDF-[12]\.[0-9](?:\r|\n|\s)/u` | At most16 header bytes | Fixed-width check; overlapping last alternation is constant, not a backtracking chain |
| `classify.ts:43`, `/\0.*$/u` | Exactly at most8 tar checksum bytes | Finite constant-size scan, even on newline/nonmatch |
| `classify.ts:44`, `/^[0-7]+$/u` plus `parseInt` | Same checksum slice | Anchored octal scan over at most8 bytes |
| `classify.ts:88`, `/^[\x20\t\r\n]*(?:\{|\[)/u` | Complete admitted decoded sample | Leading whitespace and following delimiter disjoint; anchored linear failure, not nested repetition |
| `shared.ts:120`, `/[\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu` | Arg names capped; backend targets/errors not admitted | Single-codepoint escape; unbounded input/expansion gap, not exponential regex |
| `index.ts:19-46` | CLI scan, `Array.from` short flags, argument escapes | Sum of UTF-8 bytes+1 per field capped65536; operands capped1024; parse not step-metered but input bounded |
| `classify.ts:13-66` | Signature arrays, `ascii`, guarded DataView reads, fixed lookup tables | Constant signature lengths; ASCII helper max16 bytes; tar sum exactly512 bytes; PE offset checked within sample before signature read |
| `classify.ts:69-92` | Fatal UTF-8/UTF-16 decoder, codepoint controls loop, ASCII `every`, JSON.parse | Default sample cap65536; charged sample bytes before classification; complete object/array only; no reviver/eval/regex compilation |

Header cases fully inspected: PNG/GIF/JPEG/WebP/TIFF/BMP/ICO/PDF; gzip/bzip2/XZ/
Zstd/ZIP/7z/RAR/tar; ELF/PE-DOS/Wasm/SQLite/OLE. Header offsets never request an
additional unbounded read, decompression, native file/libmagic or database load.
JSON parse builds a temporary object graph but input is bounded and charged;
no separate structural-depth cap exists. Engine parser and decoder work cannot
be interrupted mid-call by the timer; `checkTime` runs before/after. This is a
bounded classification profile, not complete validation/security certification.

SharedBudget is constructed once for all operands. Defaults: maxInput8MiB,
maxOutput1MiB, maxChunk1MiB, maxSniff64KiB, maxReadFile1MiB, maxSteps1Mi,
maxEntries1024, maxArgumentBytes65536, maxDuration10s. The three corrected
holdouts separately configure maxReadFile64KiB; do not conflate that with default.
`prefix` charges one step per delivered chunk (including empty chunks), all
delivered input bytes before retention, and retained sample length before
classify. Input/sample charges accumulate over operands. A step call yields
every128 calls, not every128 bytes. Multiple finite linear classifier passes
are covered by a byte-work proxy, not separately enumerated CPU instructions.
Fallback preflights known size, passes maxBytes/signal, rechecks result length,
charges full delivered bytes and retains a bounded copy. Host allocation may
precede checking. Output accounting is cumulative but has TEXT-BOUND-001's
precheck allocation gap. Repeated stdin operands classify empty after first use.

No worker/session executor API is used by either candidate. File owns a timer,
cleared by command `finally`, and per-file controllers aborted in local `finally`.
Tree removes abort listeners in local `finally`. No needless worker API is
proposed. If authors introduce owned workers/sessions, the read-only07acb1a
contract requires cleanup registration before acquisition plus local finally;
this review does not authorize adding such resources or changing lifecycle code.

## Completed harness correction verdicts

- **N18 HOLD.** Exact additive diff is clean, but the actual helper accepts
  `tree: -L failed; width must be between 1 and 256\n`: relevance is checked per
  line, then any constraint on that line is accepted. It also accepts
  `tree: -L must be positive\nvalid range: 0..256\n` because the contradictory
  second line is filtered out. Both were reproduced with the actual helper on
  finite mock bytes. Bind constraints to the correct subject and reject
  contradictory bounds across the diagnostic; preserve current evidence.
- **F29 HOLD.** Signal presence/output/readFile checks remain, but `aborted=false`
  and `reason=undefined` are tested after successful execution. A valid composed
  FS signal active at call time may be aborted by successful resource cleanup
  while the caller remains active. The exact extracted assertion block rejects
  that mock lifecycle. Snapshot liveness at FS entry, not after settlement; keep
  reason propagation checks in F33/F34. No product change to remove composition.
- **F33 GO, F34 GO**, scoped to additive predicate/evidence acceptance only.
  Exact caller rejection identity, FS `.aborted` and exact `.reason`, and return
  count1 remain. Raw records show pending-read rejection injected in both;
  F34 additionally injects pending-return rejection. Injections precede the
  two-turn empty-unhandled check and final gate release. Deferred mocks have no
  catch; telemetry adds no promise handlers. This does not certify unlimited
  future host errors, new source safety, release readiness or other cases.

The old runner is exactly transformed by two replacements, then eight telemetry
replacements; no other case assertion changed. Verified285 original file
publication entries,37 correction entries and25 recorded loaded-module hashes.
Verified35 tree correction entries and its exact two-edit inverse derivation.
Earlier independent verification covered316 tree original entries and54 file
sealed artifacts; original manifest/catalog hashes still match. Original history
copies retain original runner hashes. No initial failure was rewritten.

Both reviewers executed only the authorized old frozen cases: tree1 + file3.
This peer executed zero product cases. Tree initial38 remains30pass/2fail/
3unsupported/3characterizations; N16 profile and N18 native status/text difference
remain non-parity. Initial native lane12match/5mismatch/3unsupported is unchanged.
Tree correction's claimed31 semantic passes includes one predicate now on HOLD.
File initial40 remains35pass/3fail/2backend-limitations; adjudicated31pass/
4native-conflicts/3harness-defects/2backend-limitations. Its optional34pass mixed
index is not independently approved wholesale because F29 remains on HOLD.
File semantic80/80 and machine-exact50/60 are reused, not rerun. F30/F31 stay
characterizations; unsupported0; PE/Wasm stay unexecuted independent specimens.
Both corrections explicitly reuse37 old cases each, not a full38/full40 run.
SQLite canonical MIME is a separate source delta and was not executed here.

## Proposed bounded executions: root authorization required

No executable product harness or new corpus was installed. Proposal only: at
most six isolated cases after authors freeze their sources, one child at a time;
5-second hard parent watchdog,128-MiB V8 heap,256-MiB observed RSS stop policy,
64-KiB captured stdout+stderr cap and30-second whole-batch cap. RSS monitoring is
not a hard native-memory sandbox. Kill only the owned child on timeout; record
failure/partial bytes, no retries, no background workers/native comparisons.
Use explicit mock VFS/byte sources; no network/host FS access by product. Record
source hashes, exact inputs, family overrides and actual counters. No edits to
author tests, original fixtures, defaults, shared regex executor or FS contracts.

1. **T-empty-many:** 255 pipes in `-I`,64 unique128-byte regular basenames.
   Independent expected result: none excluded. At most2,113,536 bytes of old
   empty-row allocation by static arithmetic. Compare fixed normalization or
   precharge proof; a semantic/time smoke pass alone cannot disprove WORK-001.
2. **T-DP-cumulative:** `-I '*a*a*a*a*a*a*a*az'`,64 unique128-byte names ending
   in `q`, maxSteps4096. Every match is false; each individual input is bounded,
   but combined real DP work exceeds quota. Require cumulative limit rather
   than per-entry reset, allowing optimized equivalent work to complete if
   genuinely eliminated. Pair source-accounting review with observed effects.
3. **T-sort-many:**64 unique512-byte shared-prefix names, alternating directories
   and files with empty children, `--dirsfirst`, maxSteps4096. Verify exact
   ordering or explicit work-limit result, under the author's disclosed byte/
   comparator accounting policy. No fixed millisecond performance assertion.
4. **F-JSON-cumulative:** eight8190-byte complete whitespace-heavy malformed
   array prefixes (8189 spaces plus `[`), streamed in1-KiB chunks; maxSteps16384.
   Conservative text classification for completed samples before cumulative
   limit; no parsing success requirement. Retain exact input/output/return counts.
5. **F-header-many:**32 independent512-byte incomplete/near-miss PDF/tar/PE/SQLite
   samples, no native fixture reuse; maxInput32768/maxSteps32768/output4096.
   Validate bounded read requests/early-return/no excessive header-offset reads;
   format names are characterizations unless independently predeclared.
6. **F-metadata-many:**32 symlinks with4096 control-heavy target codepoints,
   output4096, then typed output/admission failure as defined by author policy.
   At most131072 input codepoints prepared. This finite behavioral probe does
   not itself prove pre-allocation safety: inspect the new preflight/streaming
   escape path and cumulative metadata policy. Never fabricate a new FS API.

These small cases are proposals, not executed passes or mandatory new public
options. Root should settle the accounting policy and approved source hashes
before executable test implementation. Stop here; no broader suite is implied.
