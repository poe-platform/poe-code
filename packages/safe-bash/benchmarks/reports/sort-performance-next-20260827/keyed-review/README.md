# Independent single numeric-key reuse verification

**Verdict: PASS for root review of the bounded single-key stage.** Root makes final
acceptance. No product edits were made by this verifier. No timing was authorized
or performed as a benchmark; incidental TAP durations are immutable raw metadata,
not performance evidence. No new native oracle, full gate or broad parity claim.

## Exact identities and independence

- Pre-key full commit: `08a26051438f5c6bdde100a4fe724dbb84f6fca4`.
- Explicit root-routed candidate: `b4fe4c7868b7ab7067599c6f5d10e99d143aea54`.
- Baseline text SHA256: `dfc9baed56564395bf90472fd505ea56a8eb5820712c0a5096d95ef2e2db47cc`.
- Candidate text SHA256: `9a66dc0e320c62aad86d78da9c55580cf6910a537a47db8a330e5122f63a1895`.
- Original 28-case/10-recipe/9-intent freeze: `e7ad14adb99877f2e37c4354533755ed3cf777de`,
  before author edits and any candidate inspection. Ready marker initially used
  its unique short ID, promptly expanded to the full commit.
- Pre-candidate versioned fixture/intent clarification: `2d57eab6`; root adjudication
  recorded in `4f0ee758`. V2 baseline28 passed before candidate inspection.
- Direct-handler ownership adapter frozen in `cea2baca` before its execution.
- Accepted evidence reused read-only from `3fe952ea89034ceea784be26731581aabbb898c8`.

Both actual products were independently archived from exact committed source,
compiled with the installed development compiler, npm-packed without scripts,
then moved into otherwise bare consumers. Package-only imports resolve
`virtual-bash`; load hooks constrain all non-builtin modules to that consumer.
Source, dist, tarball, moved files and loaded modules have before/after hashes.
No live product inputs were overlaid. Final integrity checks enumerate complete
file names and hashes, detecting new regular files and rejecting unexpected
symlinks; the sole allowed symlink is the explicit build toolchain link.
Earlier helper inventories skipped symlinks; final stronger checks cover the
still-present snapshots before removal. This qualification is not hidden.

`source-review.json` and `actual-source-delta.diff.txt` disclose all four committed
source differences: sort text, two column files, and shell runtime. The actual
candidate contains those unrelated changes faithfully. Exports, contracts,
exact numeric parser/comparator, key extraction, owned record collection/output
and accepted unkeyed cache sections are byte-identical. Do not attribute any
whole-tree performance change to the sort patch.

## Cohorts, kept separate

| Cohort | Pre-key baseline | Exact candidate |
| --- | ---: | ---: |
| Original independent key freeze | 26/28 | Not relabeled or replayed |
| Root-authorized v2 key cases | 28/28 | 28/28 |
| Bound generic cap recipes | 10/10 | 10/10 |
| Unchanged accepted workload cases | 21/21 | 21/21 |
| Unchanged revised unkeyed independent cases | 34/34 | 34/34 |
| Unchanged accepted unkeyed caps | 11/11 | 11/11 |
| Supplemental direct ownership, same two inputs | 2/2 | 2/2 |
| Scratch instrumented controls: 28 + 10 + two existing recipes | 40/40 | 40/40 |

The original missing-file diagnostic was abbreviated incorrectly in the fixture;
the original output-budget fixture named a nonexistent option. V2 changes only
the exact stderr and `maxOutputBytes` option/typed rejection identifier. The
original failed bytes and TAP remain in `baseline-attempt1/`; the actual public
`ShellLimitError` class is asserted. Root independently authorized both fixes.

The baseline-only memory-intent correction is also explicit: selected decoded
key backing can be charged without double-charging an already-owned unrelated
record suffix. The original overstrong intent and root reasoning remain intact.
The selected key's *entire* nonnumeric suffix must still be accounted, not just
its normalized numeric prefix. Existing full-record storage is tracked separately.

## Counters, not timing or heap measurements

All 40 instrumented observations match baseline bytes, status, stderr, namespace
effects, sort-comparison counts and exact numeric-comparison counts. Scratch
instrumentation/mutants are not the actual moved product controls.

| Existing diagnosed recipe | Pre-key baseline | Candidate |
| --- | ---: | ---: |
| Keyed 8000: sort/numeric comparisons | 82,450 | 82,450 |
| Keyed 8000: numeric parses | 164,900 | 8,000 |
| Keyed 8000: key extractions | 164,900 | 8,000 |
| Keyed 8000: field objects | 494,700 | 24,000 |
| Unkeyed 8000: numeric parses | 8,000 | 8,000 |
| Unkeyed 8000: comparisons | 92,882 | 92,882 |

Keyed recipe admissions are 8,000; hits 156,900; retained-string charge 194,680
logical bytes. Existing record payload is 156,670 bytes, separately retained.
The cache admits at most 16,384 descriptors and 1,048,576 logical retained-string
bytes, charging `6 * selectedKeyBytes + 2`. Exact retained boundaries are
1,048,570 / 1,048,576 / 1,048,582 proposed aggregate bytes. The above-bound
case bypasses retention; entry-above, empty keys and mid-sort stable saturation
exercise uncached fallback. Huge selected keys bypass despite tiny parsed
prefixes; huge unrelated record suffixes retain only three tiny key descriptors
(24 charged bytes), with existing record backing verified separately.

Construction/admission counters reject excluded multi-key, nonnumeric, effective
blank/fold and global check modes. Admission descriptors contain only two strings
and a boolean; their map keys reference already-owned records. Source inspection
finds no retained extracted byteview or newly decoded whole-record string.
Entry count bounds descriptor count, not exact Map/object overhead. The logical
string budget excludes transient parsing/field allocations and is **not** a V8
heap/RSS bound. Existing input ownership uses unchanged 32 MiB logical record/
line limits; this bounded matrix does not newly execute that maximum-size boundary.

## Negative controls and disclosed harness limit

Original mutation campaign catches **12/14** mutants. Wrong key, modifier
direction/merging, floating precision, guard modes, entry/retained caps,
prefix-only backing charge and bad fallback are detected. Several cap/guard
mutants preserve every output byte but fail counters, so output-only agreement
is not presented as cap proof.

The two collector-copy mutants survive original Shell stdin cases because Shell
ingress copies their borrowed input first. Those failed negative controls remain
in `mutation-summary.json` and their original captures. After reporting the gap,
root authorizes a separately frozen direct-handler adapter for exactly the same
two bytes/argv/width/reuse/finalizer schedules. Actual public-handler controls
pass 2/2 per snapshot. Supplemental complete-view mutant fails 1/2 cases;
pending-view mutant fails 2/2. Thus both previously surviving mutation categories
are detected at the correct boundary. This is **original12/14 plus supplemental2/2**,
not a rewritten original14/14 or new case corpus.

## Evidence and cleanup

`operation-comparison.json`, `cap-binding.json`, `mutation-summary.json`,
`direct-ownership-summary.json`, `source-review.json` and `final-integrity.json`
are the concise machine-readable entry points. Each run retains raw stdout/TAP,
stderr, child settlement, exact observations or bounded digests, and loaded-module
proof. Prior accepted worker JSON stdout retains its original bytes even where
the generic capture suffix says `.tap.txt`; it is not asserted to be TAP.
`used-tools/` preserves all four actually executed worker variants by content hash.
`ARTIFACTS.json` seals the final report inventory; it excludes itself.

All 29 owned test child handles closed without watchdog kills. Builds use bounded
child execution; each test child uses 512 MiB V8 old-space, a 16 MiB captured-output
limit and a 180-second parent watchdog. Inputs stay bounded by frozen recipes.
Two exact owned scratch roots were removed after final integrity checks. No
global process kill, foreign restore/staging/config/dependency edit occurred.
Handoff markers remain intentionally available to root.

Frozen8670 is old-source evidence. Existing48 mismatches, 23 native-dependent
not-rerun rows, and original unkeyed32/33 versus revised34 remain historical, not
new passes. This report does not establish broad superiority, deployment support,
full-gate acceptance, elapsed work duration or the 72-hour requirement.
