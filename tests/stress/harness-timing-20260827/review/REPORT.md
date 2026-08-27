# Independent harness-only review

## Recommendation and boundary

Accept implementation **`fa4c80035848ce5eab1efe3ae47862eac03ae7c9` only as the
recorded harness timing/profile correction**. The declared independent checks
passed without retries, skipped failures, warning-only prefix acceptance, or
product edits. Provisional cleanup finding R1 was corrected before handoff and
the corrected missing-acknowledgement branch was independently exercised.

This is **not a fullgate pass, source/default acceptance, native-profile parity
claim, performance guarantee, or superiority finding**. Parent checkpoint
`c467e8a` remains NO default acceptance: F1 invocation-cleanup and glob/walk
ownership blockers remain. All six reserved pathological allocations are unused.
No new risky regex, external network, user-file fixture, subagent, runtime
dependency, product process wrapper, or evaluated child program was used.

## Identity and independent expectations

- Independent acceptance was committed as `9c85c63` before author-ready, from
  static freeze `7e828a4`, not inferred from author passes. All **20** original
  snapshots matched manifest hashes and original git objects. All **15** vector
  inputs/argv and **330** expected status/stdoutHex/stderrHex triples were frozen.
- Author implementation `fa4c800` and evidence `0619e1c` were authenticated:
  **17 implementation files + 82 artifacts + one report**, matching both SHA-256
  and git bytes. These 100 files remained unchanged through review. Author
  manifest SHA-256 is
  `4a2f7cca93a2aa81e5e4cde09f2c7d6ebac779d630a2e7017921177112ae03fd`.
- Independent static audit passed **12/12** checks. The jq loop changes only
  adapter import and outer test bound. Shared jq/search helpers remain identical.
  Whole-write, backpressure, and exact cancellation test bodies remain byte-for-
  byte identical; the wrapper retains its exact zero-status/pass6 assertions.
- Product limits remain input/output 65,536 bytes, value 32,768 bytes, 4,096
  results, 100,000 steps, and Shell output 65,536 bytes. Product command contexts,
  argv, collector bounds, partitioning and result comparisons were inspected.
  No product cancellation policy or intentional cancellation test was changed.
- The original shared-helper **1,500ms signal starts after imports**. Its
  historical failures are execution aborts, not loader timeouts. The dedicated
  adapter now uses a separately named 15s harness watchdog and 120s vector bound;
  the streaming wrapper changes from 5s to 120s. These are disclosed harness
  resource/timer changes, not relaxed product work/output limits.

Machine-readable roots: `acceptance-freeze.json`, `evidence/static-audit.json`,
`evidence/author-authentication.json`, and `evidence/review-summary.json`.

## Actual execution denominators

All dynamics waited for author-ready. Root approved the three-descendant
schedule in the archived root notes. Exactly one serial pair and **two**
concurrent rounds ran; launch order alternated. The wrapper ran serially only.
Concurrency covers jq plus the wrapper's direct six-case canonical child, not
the outer wrapper concurrently. Maximum scheduled test/native descendants: three.

| Independent cohort | Actual outcome | Parent-observed process time |
| --- | --- | --- |
| Serial canonical jq | 15/15 cases; 330/330 exact triples | 7,665.26ms |
| Serial canonical wrapper | 1/1 wrapper; internal 6/6 | 360.43ms |
| Concurrent round 1 jq | 15/15; 330/330 | 7,534.69ms |
| Concurrent round 1 streaming cases | 6/6 | 253.55ms |
| Concurrent round 2 jq | 15/15; 330/330 | 7,433.44ms |
| Concurrent round 2 streaming cases | 6/6 | 254.33ms |
| Independent negative guards | 7/7 detected expected failures | Guard process 3,866.63ms |
| Independent controlled-child calibration | 1/1 | 45.41ms within guard process |

Totals are **45 jq cases / 990 exact triples**, **18 streaming child cases**,
and **one wrapper assertion**. Repetitions are not additional unique coverage.
Every jq trace digest was checked against the pre-handoff expectation keyed by
vector/route/transport, with uniqueness and completeness checks. Each of the six
canonical process results also passed four independent semantic/cleanup checks
(24/24 checks). No independent positive attempt failed, no fixture was corrected
after execution, and no run was retried. Expected negative rejections are retained
as failures of the mutated harness scenario, not native semantic passes.

The canonical window was **August 27, 2026, 06:46:22.065–06:46:45.389 UTC**.
This is the measured replay window, not a work-duration or 72-hour claim.

## Native profiles and actual progress

Observed tool profile: Node **v22.22.2**, **Darwin arm64**, ripgrep **15.2.0**
revision **e89fff89ac**, PCRE2 10.45 available. The fixture uses literal `foo`;
the argv does not request PCRE2. `evidence/native-profile.*` retains the actual
version command, output, process lifecycle and isolated review-directory cwd.

Original delayed profile: `rg --no-config foo -`, inherited environment, three
pipes, nine bytes `666f6f0a000a6e6f0a` delivered one byte each 25ms. Corrected
profile: **`rg --no-config --line-buffered foo -`**, with `LC_ALL=C`, `LANG=C`,
empty `RIPGREP_CONFIG_PATH`, and `NO_COLOR=1`; four prefix bytes are written,
actual `foo\n` output is observed, then the five-byte NUL suffix and EOF are sent.
Virtual argv remains `foo -`; virtual suffix also waits for actual prefix output.
Both flags/environment and delivery schedule adaptations are explicit. This is
**not unchanged original 25ms delivery parity**. The distinct whole-write native
profile and warning-only expectation remain unchanged.

All nine native prefix runs required status0, empty stderr, and exactly `foo\n`
plus the frozen binary warning. All nine exhibited stdout-prefix evidence before
readiness and before suffix delivery. Serial repetition 1, for example, recorded
spawn at 2.988ms, first stdout at 21.401ms, readiness at 21.418ms, suffix at
21.506ms, exit at 22.022ms, and child close at 22.058ms. Stdout/stderr closes are
separately recorded. **Spawn or a write callback is not input consumption**;
observed matching output supplies evidence of a prior read, not a read-syscall
timestamp. The startup-without-consumption negative verifies that distinction.

For jq, module readiness, execution start, first entered read, first output and
completion are recorded for every invocation. Serial module-ready was 165.537ms
on the child's performance clock; first parent-received stdout was 177.786ms on
the parent's launch-relative clock. Those clock domains are not subtracted.
Maximum individual jq execution times were 465.942ms, 328.609ms and 320.019ms for
serial/round1/round2, respectively. These cohosted modest repetitions are not a
performance benchmark or evidence of behavior under fullgate contention.

## Independent negative controls and R1

The verifier saved five exact static mutations of the frozen native supervisor:
a tiny static Node child replaces rg only in the test copy; independent controls
can suppress readiness, withhold suffix, or delay the helper's real close event.
No product module is imported by that controlled child. The copied TypeScript,
emitted ES2022 module, compiler version and every replacement are retained in
`controlled-native.ts.txt`, `controlled-native.mjs`, and
`evidence/controlled-mutations.json`. This is supervisor verification, not native
oracle equivalence. The positive calibration prevents an always-failing fixture
from satisfying the negative expectations.

| Guard | Required failure / observation | Measured duration |
| --- | --- | --- |
| Suppressed readiness after actual prefix output | readiness timeout; no suffix sent | 1,005.24ms |
| Startup announced, prefix not consumed | readiness timeout; stdout empty despite spawn/write | 1,004.10ms |
| Suffix withheld after genuine prefix output | completion timeout | 231.97ms |
| Child never ends after actual suffix delivery | completion timeout | 229.74ms |
| Readiness timeout plus held close acknowledgement | primary timeout AND cleanup deadline retained | 1,105.23ms |
| jq watchdog stall | abort observed; same reason; no abort listener remains | 22.86ms |
| Late rejection after watchdog | rejection observed under strict unhandled-rejections | retained 60ms/20ms fixture |

Injected native bounds were readiness1,000ms, completion200ms, cleanup100ms;
the independent 3s last-resort bound **never fired**. Native timer records include
arm, due, actual fire and lateness, here approximately +1.50 to +2.52ms. The
separate jq watchdog uses20ms and records the same timer accounting. Timer
scheduling and successful cleanup observations do not establish hard deadlines.

R1's original source hash
`99b21733e0051df6bf2581814446262c1f364eb08d582251e4155f1909afb554`
had a cleanup branch that killed again without settling. Its static finding and
source are retained in `STATIC-FINDINGS.md` and `native-delivery-in-progress.ts.txt`.
Final source hash is
`3e415abe8d16c9e42037fa16793632c9ea23feb199580c5e6837cb9d886f1bb4`.

The independent missing-ack test delays **only the helper's notification of an
already observed genuine child close**, retaining the independent exact handle.
At rejection the helper honestly reports actualClose=false, retained listeners,
the readiness failure and the cleanup-deadline event. The real child is already
closed. Releasing its saved genuine notification then removes the helper's
remaining listeners. This proves bounded failure plus late-ack cleanup without
manufacturing a real OS/process leak or pretending incomplete cleanup succeeded.

## Source drift, cleanup, and limits

The consumed snapshots hash **192 source files** plus the relevant tests/helpers.
No hashed source or harness file changed between canonical start/end snapshots.
This is a working-tree pre/post observation, not proof against transient changes
or a clean-checkout run. Before this cohort, other workers changed
`src/commands/diff-patch/unified.ts` and `src/fs/webdav/webdav.ts` relative to the
independent acceptance freeze. After the cohort, `src/commands/diff-patch/patch.ts`
and `src/commands/diff-patch/unified.ts` changed again. All old/new hashes and
capture heads are retained separately; the recorded replay is not asserted to
cover a later entire source tree. Earlier author-static-to-review drift in
`src/commands/stream-format/seq.ts` is also retained in `acceptance-freeze.json`.

Eight directly observed review child handles (seven canonical/profile children
and the negative driver), seven controlled children including the sentinel, and
nine reported native-prefix children have actual exit/close and stream-retirement
evidence. No direct handle remains active. The unrelated owned sentinel stayed
alive throughout the native controls and was retired by its own exact handle.
No ps, process-group kill, broad kill, or cleanup of other workers' artifacts was
used. The inner wrapper child and three whole-write oracles completed through
the unchanged synchronous helper; it exposes successful status and complete
captures, **not separate asynchronous per-stream close timestamps or oracle PIDs**.
This limitation is not replaced with invented event timing. No global process
inventory or product Worker invocation-cleanup guarantee is claimed.

Original fullgate `51282a9` remains **15,958 instances / 15,769 pass / 110 fail /
79 skip**. All selected **13 jq execution-deadline failures + one native-rg
warning-only delivery failure** remain preserved. Plato's isolated15/15 runs are
not fullgate passes. The author's old25ms records, failed default-prefix
observation, first-attempt source and later correction evidence remain intact.
The author's first-attempt concurrency is not relabeled final-correction evidence;
this verifier's two rounds supply the separate final-source scoped replay.

The historical global cold typecheck's six diagnostics were read and copied
unchanged, not rerun or fixed. Plato/root retain type ownership. The author's
final scoped typecheck exit0 was authenticated, not independently rerun. No
full-repository tests, fullgate, build, broad fuzz, or additional rounds ran.

## Commits and handoff

- `9c85c63`: pre-handoff independent acceptance and 330 expected triples.
- `c7aa2ed`: provisional R1/source snapshot and bounded review tools.
- `548dc94`: fixed schedule and static benign child fixture.
- `debb29e`: independent audit, canonical runner and negative guards.
- **`0dd9b70`**: frozen actual results, authentication and timing/cleanup evidence.
- This report is committed separately; the exact report commit and SHA-256 are
  supplied in `/tmp/harness-timing-review-ready.txt`.

All commits use `git commit --only` with explicit review-owned file paths.
The final handoff checks review tracked/untracked cleanliness and the index;
concurrent unrelated working-tree changes are preserved, not included in these
commits. Recording scripts use create-exclusive evidence paths and must not be
rerun over this sealed cohort. Commands actually used are in the process JSON
records; `run-guards.mjs` and `canonical.mjs` define the completed fixed schedule.
