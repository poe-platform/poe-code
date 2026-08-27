# Independent next sort diagnosis — August 27, 2026

## Decision requested, not implementation approval

**Consider exact numeric-descriptor reuse first; separately consider extending it
to one numeric key. No product change is made or authorized here.** Counters prove
repeated preparation work, not its percentage of CPU time, a performance win,
just-bash superiority, or completion of the broader project/72-hour requirement.
The historical pipeline gap is not addressed by these proposals.

## Frozen identity and scope

- Selected observed current committed snapshot at admission:
  `e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64`; tree
  `f00389122e9db748312500135d20fb29ace509d1`.
- Prior integrated source: `7ba5301d43345c2eb621b7df95a452a87b74e909`.
  Independently sealed evidence: `96e051e81312c7d33d8f4f5078efa09a4dd87947`.
  All **59** entries in that commit's `evidence/ARTIFACTS.json` authenticate.
- Product was checked for dirty paths before extraction. No dirty production
  bytes were read into the experiment: all 221 source files came from selected
  Git objects. `inputs.json` records full blob IDs, SHA256s, sizes, tree, status,
  prior hashes, evidence identities and intervening source delta. Concurrent
  HEAD changes are observations only, never substituted inputs.
- `src/commands/text.ts` is byte-identical to 7ba5301: SHA256
  `08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d`.
  **Other source is not identical:** internal.ts now copies retained Buffer tails
  in `lines` and chunks in `collect`; execution.ts has env-option changes.
  The selected snapshot is not silently qualified by any historical gate,
  including frozen8670. No old report, source gate or historical evidence changes.
- Own writes are confined to this new report subtree and the assigned
  `/tmp/sort-performance-next-independent-*` scratch/markers. No root exports,
  product, registry, dependencies, private checkout, foreign files or index edits.

## Declared workloads and equality

`workloads.json` freezes **21** specimens before any successful execution:
7 unchanged prior recipes (historical pipeline, plain, paths, both numeric cases,
in-place and tiny) and 14 small controls. Prior recipes, stdin, initial files and
expected final bytes are checked against sealed native captures, not regenerated
with a different seed/size. Nine controls select exact existing GNU9.7 observations
4/5/6/28/29/30/32/33/34 from committed core-sort/native.json. Three hand-declared
goldens cover exact decimal/zero/prefix stability, check-mode duplicate failure,
and missing-input preservation of `-o`. Two borrowed-Buffer controls use the
committed producer/bytes with `/input` adapted to `/work/input`.

All **21/21 control and 21/21 instrumented calls** match exact stdout, stderr,
status and final `/work` file bytes. Their observation hashes also match each
other. `-o` has a real final-file equality gate, not only stdout. This is a small
equality control, not full product validation or service acceptance. No native,
baseline, regex/pathological or broad test campaign ran.

The initial hand-written missing-file diagnostic said `open`; source inspection
showed MemoryFileSystem uses `readStream`. That one expected string was corrected
**before executing any workload**, without changing product/status/effects.
`workloads.initial.json` preserves the original; both freeze hashes and the
correction are recorded in `attempt-2/run-freeze.json`. This is disclosed fixture
history, not an unchanged-all-input claim.

## Counting method and limitations

Two sequential children: one uninstrumented, then one instrumented; one call per
specimen, no warmup/repetition/timing study. Each specimen uses actual public
Shell/agentCommands, byte stdin and a fresh memory FS, with the same environment,
4MiB output limit, 10,000 command/loop budgets and 4,096-byte pipe high-water mark
as the prior worker. Fresh shells differ from the old warm reused-shell schedule;
these are operation observations, not directly comparable timing samples.

Each child has Node's 512MiB heap flag, 60s CPU guard, 90s supervisor deadline,
5s per-exec abort and 8MiB combined log bound. The heap flag is not an RSS cap;
abort cannot preempt synchronous Array.sort. Exact child handles are awaited on
close, timers cleared and every Shell disposed. The startup/import phase is
outside counting, no CPU/heap sampling is claimed, and current cohost/Curie load
precludes wallclock-win conclusions. Recorded one-minute load was about 4.46.

Node is **22.22.2**, TypeScript **5.9.3**. Existing TypeScript performs isolated
ES2023/ES2022-module transpilation of 183 TS modules: no dependency installation,
normal product build, typecheck, or source overlay from the live worktree.
`instrumentation.json` records tool hashes, every emitted/input hash and all 18
counter insertions. Only isolated text.ts/internal.ts differ. The instrumented
sources are retained as `.ts.txt` evidence, not canonical product/test inputs:

| Input | Original SHA256 | Instrumented SHA256 |
|---|---|---|
| text.ts | `08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d` | `ce1526a21f2e8b3c67a0833e43a1e0c0bb673d8ade085ae78aae182c0763576d` |
| internal.ts | `ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654` | `0aa3752daf3e9704ad5f4cca70e3b3f02f58deb0e7fa65d70f2f1a0154874803` |

Counters use Maps/WeakMaps, retain record identities, and add calls/objects. They
distort JIT/allocation/GC and cannot measure speed or original peak heap. Numeric
input-copy bytes count arguments to existing `Buffer.from`, not allocator bytes.
Field-object counts count source object constructions, not V8 heap objects after
optimization. Key scan bytes are full input-line lengths (excluding the extra
end-position test); these are meaningful for the measured explicit separator,
not exact instruction counts for all whitespace-key modes. Distribution maps
are valid for these zero/one-key specimens, not an unmeasured multi-key cache.

## Observations

| Frozen workload | Records | Sort comparisons | Numeric parses | Key extractions | Collector scan bytes |
|---|---:|---:|---:|---:|---:|
| Historical sort\|uniq5000 | 5,000 | 54,095 | 0 | 0 | 49,447 |
| Plain5000 | 5,000 | 54,095 | 0 | 0 | 49,447 |
| Unique paths20000 | 20,000 | 258,589 | 0 | 0 | 535,459 |
| Numeric stable8000 | 8,000 | 92,882 | 185,764 | 0 | 138,195 |
| Numeric key8000 | 8,000 | 82,450 | 164,900 | 164,900 | 164,670 |
| In-place5000 | 5,000 | 54,095 | 0 | 0 | 49,447 |
| Tiny32 | 32 | 118 | 0 | 0 | 145 |

Paths additionally make 19,999 uniqueness comparisons. Plain and historical sort
have identical comparator and collector counts; historical `uniq` adds 5,000
async line yields, 44,447 line-concatenation bytes, 4,999 byte comparisons and
997 awaited output calls, versus one sort output call. That identifies additional
pipeline work, **not a proved dominant CPU bottleneck** or a license to batch
online uniq output: the existing core-sort README explicitly preserves its live
pipeline behavior. There is no numeric work to save in historical/plain/paths.

Numeric-stable parses each record **min12 / median22 / p95 36 / max59** times,
copying 3,018,123 logical input bytes during parsing versus 130,195 collected
payload bytes. The parser at text.ts:7 constructs a function per comparison,
copies/Latin1-decodes each operand, regex-matches and normalizes decimal strings.
It also executes 61,946 fraction `padEnd` calls; those remain outside the proposed
optimization. The collector makes one owned record copy per input record in this
single-chunk workload, with no unfinished-tail concatenations to eliminate.

Numeric-key repeats preparation **min9 / median20 / p95 27 / max70** times per
record. `keyBytes` at text.ts:41 scans all fields, not just the selected second
field: 3,230,564 logical line-scan bytes, 494,700 field object constructions and
164,900 subarray selections. Numeric parsing copies 613,178 selected bytes.
This is concrete avoidable repeated work. No CPU sample establishes its time
share relative to regex, comparison, byte collection or the baseline engine.

## Two narrowly scoped proposals

### 1. Exact descriptor reuse for unkeyed numeric sort (first priority)

Only normal sorting with no keys, `-n`, and neither `-b` nor `-f`; leave check
mode and the simple byte path unchanged. Extract the **unchanged** current parser
into an internal helper and reuse `{whole,fraction,negative}` per owned record
within the invocation. Preserve comparison/padding, reverse, whole-line fallback,
stable and unique behavior exactly. No Number/parseFloat conversion, no changed
regex, no Latin1 shortcut, no removal of input/output bounds or ownership copies.

For frozen numeric-stable8000, one descriptor per record would change
185,764 parses to 8,000: **177,764 fewer parses** and **2,887,928 fewer logical
Buffer.from input-copy bytes**. These are arithmetic estimates assuming all
8,000 entries are admitted, not measured optimized behavior or a speed promise.
It does not improve the numeric-key or historical-pipeline workloads.

### 2. Extend the same descriptor reuse to one effective numeric key

Separate approval/patch after proposal1: admit only a single effective numeric
key, neither `b` nor `f`, and not check mode. Call the unchanged `keyBytes` once
per admitted owned record, then parse that selected view once and retain only
the numeric descriptor. Do not introduce a general field/key cache, parser,
multi-key engine, or change global-versus-key flag precedence.

For frozen numeric-key8000 this would avoid **156,900 key extractions and
156,900 parses**, **470,700 field object constructions**, **3,073,894 logical
line-scan bytes**, and **583,398 logical numeric-copy bytes**. The once-per-record
baseline is 8,000 selections/parses, 24,000 field objects, 156,670 scan bytes and
29,780 selected bytes. These savings are not additive to proposal1 on the same
input: proposal1 deliberately bypasses keyed sorting.

### Bounds, memory and cancellation for either proposal

Require bounded admission, e.g. at most **16,384 descriptors** and **1MiB of
conservative logical character charges**, with the original uncached comparison
on overflow rather than changing status or the 32MiB input admission policy.
These are proposed internal caps, not existing guarantees or a required new API.
Do not charge the cache against the input limit or reject previously valid input.
Avoid eager descriptors for simple/check/unaffected modes and preserve tiny
workload behavior. Empty records still consume cache entries; entry bounds matter.

Numeric-stable's unique normalized strings contain 22,523 code units (45,046
logical bytes at two bytes/unit); keyed strings contain 29,780 (59,560 bytes).
These are **not total cache heap estimates**. Strings may retain larger decoded
parents, and Maps/objects/booleans have engine-dependent overhead. A conservative
logical payload charge `2*selectedByteLength + 2*(whole.length+fraction.length)`
totals **305,436 bytes** for stable and **119,120 bytes** for keyed, before bounded
metadata. Do not assert that this is a hard RSS bound or that slices compact
storage. Long prefixes must fall back without retaining unbudgeted entries;
transient decoding/regex allocations still require scrutiny. Ordinary owned
record bytes, output chunks, buffer bounds and backpressure remain unchanged.

Keep cache lifetime inside one invocation; never key by producer views before
the collector has taken ownership. Preserve signals at collection/output and
check them during any added preparation pass; no promise of mid-Array.sort
preemption or cancellation rollback. Do not add asynchronous cache work or
change partial publication/error precedence. Primitive descriptors require no
host-resource cleanup hook. A separate verifier must stress caps, source reuse,
stable ties, input failure and abort before any production integration.

## Prior comparator evidence, not new comparison results

Sealed evidence uses published **just-bash3.4.2**, Node22.22.2 and independently
recaptured GNU coreutils9.7 sort/uniq under C locale. Its tarball SHA256 is
`f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d`;
the prior run authenticated all 955 installed publisher files using the earlier
registry authentication. This diagnosis authenticates that committed evidence,
not live installed baseline bytes, publisher metadata anew, or the latest release.
GNU executables were used on Darwin; this is not GNU/Linux or BSD qualification.
The small core-sort native fixture has its own executable SHA/profile in inputs.

Prior warm medians (18 samples/cell), collector candidate vs baseline:
plain2.153/4.091ms, paths12.426/35.760ms, numeric-stable29.951/13.694ms,
numeric-key33.890/29.800ms, historical pipeline5.868/3.640ms. These are historical
numbers for that source, not measurements of selected e090f29 or the proposals.
The original worker timed public exec, with baseline Latin1 conversion inside
the timer and setup/output comparison/file snapshots outside. It used 18 warm
and6 cold samples/cell, six rotated variant orders and separately retained
warmups; no blanket cold-start win was established. See the sealed prior README
and worker rather than inferring algorithm-only parity.

All **720 prior calls remain in their original denominator**: original240/240,
candidate240/240, baseline192/240 equality. The **48 Unicode/invalid-byte baseline
mismatches remain ineligible** for external speed claims; they are not removed,
renamed passes or rerun here. Selected eligible cases cannot establish broad
superiority. No wallclock measurements from this diagnosis are offered.

## Acceptance, artifacts and cleanup

`ACCEPTANCE.md` fixes positive/negative requirements for any later approved
prototype, with exact current frozen rows plus pinned original native/contract/
hidden tests. Additional cap/guard tests are pending verifier work, not passes.
No current full gate, deployed-service acceptance or new product defect is claimed.

`attempt-2/{control,instrumented}.json` contain counts and exact equality results;
`inputs.json`, `instrumentation.json` and `attempt-2/run-freeze.json` authenticate
inputs/tools/code. Initial root-level control.stderr preserves a harness-only
failure: macOS resolves `/tmp` to `/private/tmp`; the guard refused the first
import before a workload ran. The guard now canonicalizes only its own root.
Original worker/run sources are preserved as `.initial.mjs.txt`. `recover.mjs`
reconstructed identical authenticated trees; no product instrumentation changed.

All three child handles (one failed admission, two successful workers) closed
naturally. Both attempt cleanup records verify source/emitted integrity and
removed owned scratch. No survivors, installs, external uploads or services.
`seal.mjs` checks evidence and writes a manifest only on explicit `--capture`;
default check is read-only. Do not rerun preparation into this committed capture:
it intentionally uses exclusive creates. A future experiment needs a newly
approved isolated output and fresh identity, not changes to this evidence.
