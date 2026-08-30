# Harness-only author handoff

Implementation freeze: `fa4c80035848ce5eab1efe3ae47862eac03ae7c9`.
Independent review is still required. No product/default/fullgate acceptance,
superiority, 72-hour-work, or original-intermittent-failure reproduction claim.

## Scope and preserved identity

- Changed only the three authorized canonical test files and this owned subtree;
  did not change shared jq/search helpers, product, root types/config, or `review/`.
- Static freeze `7e828a4`, its `PLAN.md`, and every original `frozen/` path remain
  intact. `summary.json` verifies all 20 frozen records by SHA-256 and retains all
  14 selected historical failures: 13 jq execution deadlines and one native-rg
  delivery failure, not regex blocking.
- Original routing is `51282a9`; original fullgate source is
  `e36dab2b6abc216ddc89e5786a0eba76f08a1722`. Its 15,958 instances / 15,769 pass /
  110 fail / 79 skip are not superseded by these scoped checks. Plato's historical
  guarded/plain isolated 15/15 results remain distinct archived evidence.
- Current work was dirty/cohosted, not a frozen clean fullgate. Execution snapshots
  span August 27, 2026, 06:31:51.925–06:40:48.807 UTC (about nine minutes), excluding
  initial reading and final reporting. Before/after heads are recorded in
  `evidence/summary.json`. Concurrent changes to `src/commands/diff-patch/unified.ts`
  and `src/fs/webdav/webdav.ts` are explicitly hashed there; they are not our edits.

## Correction and limitations

**jq:** Keep all 15 vector identities, both direct/shell routes, all 11 transports,
and all 330 exact status/stdoutHex/stderrHex comparisons. The canonical test now
uses `scan-execution.ts`, copying the shared helper's semantic calls, file/input
partitioning and limits. Product limits remain input/output 65,536, value 32,768,
results 4,096, steps 100,000; shell output remains 65,536. Shared helper's 1,500ms
signal and intentional cancellation tests are untouched. This semantic-only
adapter instead has a separately named 15,000ms execution watchdog and 120,000ms
vector watchdog. It adds progress observation, a Promise-race/AbortController
watchdog, and collector forwarding: these are disclosed harness resource changes,
not changed product work/output/parse budgets. Timer starts after imports. The
instrumented 1,500ms cohort uses this adapter's timer mechanism, not an unchanged
copy of AbortSignal.timeout; the preceding canonical baseline is untouched.

**native rg:** `rg 15.2.0 (e89fff89ac)`, macOS/arm64, Node v22.22.2; native version
and full help are archived. Original delayed argv is `--no-config foo -`, three
pipes, bytes `666f6f0a000a6e6f0a` in 25ms one-byte deliveries. Its instrumented run
first emitted stdout at 244.49ms, after NUL at 136.08ms and final write at 243.73ms.
The instrumented producer uses recursive timers after spawn, unlike the original
setInterval; exact original canonical execution is preserved separately. Default
same-argv prefix-only observation timed out at 2,004ms with no stdout. This is a
failed observation experiment, not a reproduction of the original warning-only
failure. Both original serial canonical tests passed; the intermittent 13+1
failures were **not reproduced**. No forced-load iterations were used.

The corrected native observation profile explicitly adds `--line-buffered`, writes
`foo\n`, waits for that exact output prefix, then writes `\0\nno\n` and EOF. This
is an intentional **profile adaptation**, not identical native flags or 25ms
one-byte-profile parity. Native help and the failed default-prefix experiment
justify observable progress rather than a guessed pause. Virtual args stay
`foo -`; virtual delivery also withholds suffix until output acknowledges prefix.
Exact final `foo\n` plus binary-warning output, status zero and empty stderr stay
required. The separate whole-write native flags and warning-only assertion, both
backpressure/cancellation bodies, and wrapper's exact `# pass 6` assertion remain.
No warning-only result is accepted as streamed-prefix success.

Native watchdogs are 10s readiness, 10s completion, 5s cleanup. Wrapper changes
from 5s to 120s and disables test process isolation solely to bound descendant
count; it forwards inner timing TAP only when `HARNESS_TIMING=1`. Native events
measure launch/spawn, writes, first stdout, exit and close. Stdout establishes an
upper bound on prior native consumption; it is **not** a measured read syscall.
Virtual/jq entered-read events are measured directly. Final timer traces include
arm, due, actual fire, lateness and cancellation; initial traces are not relabeled.

## Separate cohorts

| Cohort | Outcome | Source qualification |
| --- | --- | --- |
| Untouched serial jq | 15/15 cases, 330 comparisons | Original canonical helper |
| Untouched serial wrapper | 1/1, internal pass6 assertion succeeds | Original 5s wrapper |
| Instrumented 1,500ms jq | 330/330 exact triples | Before canonical edits; adapter timer disclosed |
| Scheduled serial jq/wrapper | 15/15 + 6/6 | Attempt-one source archived |
| Three concurrent rounds | Each 15/15 + 6/6 | Attempt one; at most four harness-launched descendants including rg |
| Initial negative cohort | Four native expected failures, jq stall, late rejection | Did not exercise missing-close observation |
| Initial scoped types | Pass | Owned test entrypoints and imported closure only |
| Final corrected wrapper | 1/1; 6/6 inner cases | Implementation freeze |
| Final negative cohort | Five native expected failures, jq stall, late rejection | Implementation freeze |
| Final scoped types | Pass | No Plato/root type edits |

The single scheduled serial-plus-three-round run contains 1,320 exact jq triples,
60 jq cases, and 24 streaming cases. No second stress schedule ran. The final
correction was checked only with one wrapper, strengthened negatives and scoped
types; concurrent passes are **not** attributed to the final native correction.
The final watchdog difference affecting jq is timer tracing only; the final jq
canonical file was not re-executed after that tracing addition.

Across scheduled jq executions, maximum per-call durations were 395ms serial,
442/916/311ms concurrent, all below the old 1,500ms signal. These modest results
do not establish the historical failure's precise load mechanism. Separate
instrumented-before maximum was 66ms. All five instrumented jq cohorts recorded
330 entered-read, first-data, completion events and matching expected triple
hashes; `expected-330-triples.json` also retains the exact expected bytes.

Final three native prefix acknowledgements occurred at 10.41/7.45/8.53ms, before
suffix writes at 10.46/7.48/8.57ms; exit and close follow in every event log. These
are local timing observations, not performance comparisons.

## R1 and negative-control strength

Provisional independent R1 found that the initial cleanup timer only killed again
when close was missing and could leave the promise pending. Preserve its full
finding and the complete attempt-one source in `evidence/attempt-1-source/`.
The corrected timer always settles the failed supervision promise; real child
close and the suppressible supervisor close observation are distinct. If the OS
does not actually close a child by deadline, failure reports incomplete cleanup
and retains exact-handle observers for eventual retirement; it does not claim
successful cleanup or wait unboundedly before rejecting.

Final controls deliberately (1) suppress prefix acknowledgement after actual
`foo\n`, (2) withhold all delivery, (3) acknowledge prefix but withhold completion,
(4) suppress cleanup acknowledgement after close, (5) suppress supervisor close
observation while recording actual real-child close separately. Each rejects at
the expected readiness/completion/cleanup phase, with 250ms injected budgets and
recorded timer fires (lateness roughly -0.02 to +2.76ms). This fifth control is
observation suppression, not an OS child leak. jq stall rejects at a separate
25ms watchdog with its abort listener removed. A host promise rejecting after
the watchdog remains observed under strict unhandled rejections.

All controlled native children actually close; their three streams are destroyed,
owned listeners and timers are zero. An unrelated owned sentinel stays live
through all native mutations and is separately ended/closed, without forced kill.
Only exact child handles are killed; no external network, user files, broad kills
or pathological regex probes. All six reserved regex probes remain unused.

## Evidence and replay

`evidence/summary.json` indexes cohorts/timings/source changes;
`evidence/negative-controls-final-detail.json` retains failures and cleanup proof;
`evidence/author-manifest.json` hashes final owned code and every archived artifact.
All captures are create-exclusive. The supplied recording scripts target fixed
artifact paths and intentionally fail rather than overwrite an existing run.
For independent replay use a separate review-owned destination; do not rerun
recording scripts against these frozen paths. Canonical entrypoints remain:

```
node --unhandled-rejections=strict --import tsx tests/commands/structured-stress/jq-grammar-author-20260827/scan-boundaries.test.ts
node --unhandled-rejections=strict --import tsx tests/commands/search-stress/streaming.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/stress/harness-timing-20260827/tsconfig.scope.json
```

`git diff --check` and owned staged whitespace checks passed. No whole-repository
test/build gate was run. Independent verifier may use its approved smaller
three-descendant topology (jq plus direct streaming cases, wrapper serial only).
