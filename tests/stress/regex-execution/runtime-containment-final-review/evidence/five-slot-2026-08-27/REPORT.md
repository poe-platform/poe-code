# Independent execution: five scoped passes; sixth slot unused

## Current result and recommendation

**The six-slot audit is incomplete.** Five target jobs ran exactly once in the
frozen order: **5/5 raw harness passes, 0 raw failures, 5 scoped reviewed passes**.
Default containment is **2/2**, active caller abort is **2/2**, and the benign grep
queued lifecycle control is **1/1**. `rg-queued-abort` is **UNUSED**, not a pass or
failure. Budget consumed is **5/6 target slots and 4/4 pathological requests**.
No retry, duplicate, replacement pattern, phase-1 rerun or old-twelve rerun occurred.

The execution leaf stopped during the mandatory fifth-result inspection over a
worker-ownership ambiguity. Bounded read-only diagnosis subsequently resolved it
as a **reviewer interpretation error**, not an established product defect or
substantive frozen-harness flaw. The stop remains latched; it was not silently
cleared to launch the sixth job. This shortfall belongs to this reviewer and must
not be reported as a failing production assertion or a completed matrix.

Recommend accepting only the measured frozen **default and active-abort scope**:
actual default REQUEST_TIMEOUT origin, responsive host timers, caller-reason
identity and awaited worker cleanup at those public exec settlements. Withhold
complete six-slot acceptance because the rg queued control was not executed.
No full-shell, universal-preemption, RSS, superiority or performance-win claim.

## Fifth-result stop and ownership diagnosis

At `sibling-one` public settlement, both creation-labeled worker records show
`exited:false`, `terminationCalls:1`, `terminationAwaited:false`, and listeners
`message/messageerror/error/exit = 1/1/1/2`. That observation is real and preserved
in `evidence/grep-queued-abort.json`; it is not replaced by the final-zero snapshot.
The raw child passes because queued boundaries do not assert global worker zero.

The initial concern incorrectly equated the observer's constructor-scope `owner`
with current invocation lease/retirement ownership. The frozen contract explicitly
rejects that inference: `src/contracts/command.md:76` requires local ownership
cleanup and permits workers legitimately shared with concurrent invocations.
These source references are to the frozen snapshot, not the dirty live checkout:

- `observe.mjs:35` records the async scope at worker construction only.
- Frozen `src/commands/regex-execution/client.ts:146` decrements the shared session
  count; only the last session awaits pool retirement.
- Frozen `src/commands/regex-execution/client.ts:251` resolves a successful request
  after releasing its busy slot; successful earlier sessions do not own subsequent
  pool-wide retirement merely because they originally constructed a worker.
- Frozen `src/commands/regex-execution/client.ts:272` closes admission, awaits
  pending requests and invocation retirements, and awaits the executor close.

The queued target itself has exact caller identity and zero owned workers/tracked
listeners; both sibling workers remain alive with zero termination calls until
their held replies are released. Both siblings then return exact `ab\n`, status 0,
empty stderr. At the second sibling's public settlement, both worker terminations
are awaited and every tracked worker listener is zero. Both workers are also zero
before dispose and after the final late-error window. No third worker, replacement,
target post, cross-invocation kill or leaked final resource is observed.

Thus no source fix or changed frozen assertion is justified by this observation.
The initial unknown, read-only resolution and retained stop are recorded in
`evidence/STOP.json` and `evidence/grep-queued-abort-inspection.json`. No sixth claim
or result exists. This is an execution-review shortfall, not evidence against the
legitimate shared-worker contract.

## Measured target results

Times below are milliseconds, rounded only for display; raw JSON retains exact
values. Child time starts at fork and ends at awaited close, including startup and
the 50 ms late-error window. Each raw child exits 0 with no signal or parent kill.

| Slot | Target | Scoped result | Child PID | Fork-to-close ms | IPC bytes |
| --- | --- | --- | --- | --- | --- |
| 1 | grep-default | PASS, status 2 REQUEST_TIMEOUT | 44880 | 1171.665 | 4767 |
| 2 | rg-default | PASS, status 2 REQUEST_TIMEOUT | 46942 | 1172.643 | 4784 |
| 3 | grep-abort | PASS, exact caller rejection | 49106 | 194.313 | 4646 |
| 4 | rg-abort | PASS, exact caller rejection | 50484 | 179.648 | 4635 |
| 5 | grep-queued-abort | PASS scoped; reviewer STOP retained | 55232 | 180.399 | 14624 |
| 6 | rg-queued-abort | UNUSED | — | — | — |

Both no-signal default invocations use unchanged actual **1000 ms request,
3000 ms startup, capacity 2** settings. Neither supplies a caller signal or changes
Shell/family/result/byte limits. Their exact stderr is respectively:

```text
grep: regex REQUEST_TIMEOUT: active request exceeded 1000ms
rg: regex REQUEST_TIMEOUT: active request exceeded 1000ms
```

Each diagnostic ends in one newline; stdout is empty and public status is 2.
The frozen client emits the request-timeout code: neither Shell outer timeout nor
parent watchdog is counted as success. Acceptance-to-public-settlement intervals
are 1004.400 ms and 1003.367 ms, not claims of exact native execution duration.

Each of the four single probes posts one empty validation and exactly one nonempty
`^(a+)+$` request: 28 ASCII `a`, `!`, then the input newline represented by
`terminated:true`. All four nonempty requests are accepted after actual worker
ready. The host timer runs while that worker is alive and has not replied.

| Target | Timer scheduled | Timer due | Timer actual | Lateness | Abort due | Abort actual | Abort-to-settle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| grep-default | 98.334 | 103.334 | 104.645 | 1.311 | — | — | — |
| rg-default | 99.695 | 104.695 | 106.005 | 1.310 | — | — | — |
| grep-abort | 113.958 | 118.958 | 120.274 | 1.316 | 123.958 | 124.062 | 1.524 |
| rg-abort | 98.021 | 103.021 | 104.325 | 1.305 | 108.021 | 109.433 | 1.878 |

Both active aborts observe no reply at abort time and preserve the exact Error
object, not merely its message. Diagnostic lateness and settlement bounds remain
under 500 ms. These are one-shot measurements, not timing SLAs or direct V8
native-call entry instrumentation. All four public settlements have their worker
exited, exactly one termination awaited, and zero tracked worker/abort listeners,
before disposal. Forced native-worker exit code 1 here is the expected outcome of
product termination, distinct from parent-child exit 0 and never a parent kill.

The queued grep target is admitted at 108.246500 ms and aborted at 108.280083 ms;
exact-reason settlement follows in 0.423417 ms. Five pending callback admissions
share SHA256 `1a556f0d45086fe075c148b1c7f309bb91afb61da3b78f796853b6dab44a76dc`.
Two validations and two benign nonempty requests are posted; the target posts zero.
The held original replies are released unchanged. This is a benign real-worker
protocol/lifecycle control, **not** a fifth catastrophic-matching exposure.

## Authorization, preservation and final verification

ROOT gate SHA256:
`f0979bf95c009526e30db02b9c402867bbe176fef5816c70003d89e824431092`.
Expiry: **2026-08-27T11:20:45.477Z**. All five claims precede it and bind the exact
reviewed benign, supervisor, source, archive, fixture and prepared hashes below.
Each exclusive claim and journal append is fsynced before fork by unchanged guard
code. Each result was manually inspected and preserved before the next launch;
slots 1–4 have durable `PASS_REVIEWED_CONTINUE` decisions. Slot 5 never authorizes
continuation. No tool approval denial occurred and none was bypassed.

Exact target commands, executed separately with inspection between them:

```sh
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/guard.mjs grep-default
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/guard.mjs rg-default
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/guard.mjs grep-abort
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/guard.mjs rg-abort
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-containment-final-review/guard.mjs grep-queued-abort
```

The sixth guard command was **not run**. `final-audit.mjs` is a separate passive
post-execution evidence verifier, not a changed frozen target harness. It was run
once with `node --unhandled-rejections=strict` and its owned path. It reverified all
216 source identities and 704 emitted assets against the exact frozen commits,
snapshot and moved archive package, and all frozen harness hashes. It verified
the five claims, exact result/inspection hashes, no sixth artifacts, no active
lock, and all ten exact owned child PIDs absent (`ESRCH`): the five phase-1 children
plus five target children. No product fixture, benchmark or target was replayed.

Target stdout/stderr is empty: 0 combined child output bytes, 33456 total IPC bytes
across five separately capped children. Every child has awaited close and closed
stdout/stderr/IPC. Six actual target workers terminate once each with await, all
final worker listeners zero; no late worker errors or strict unhandled rejections.
Seven target public exec boundaries are captured, with zero tracked abort listeners
at all seven. Do not relabel shared-worker snapshots as global zero at every boundary.

The package entry SHA256 is
`80c27f63a1ddc9ad66b875b6b307ea51aae3e54844207b25d2e58bbeafed5db0`;
all worker URLs point into that actual moved package, with worker SHA256
`bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.
All unchanged 6000/8000 ms parent watchdogs start at fork; child heap/stack remain
128 MiB/1024 KiB, product worker limits 128 MiB/4 MiB. Combined output cap is 16384
bytes and per-child cumulative IPC cap 65536 bytes. No network, external/user data,
eval worker, main-thread risky matching or runtime limit changes were used.

Host: Node v22.22.2 / V8 12.4.254.21-node.39, Darwin arm64 release 25.4.0. First target
claim: **2026-08-27T09:23:03.704Z**; final target result:
**2026-08-27T09:25:58.108Z**. Summed fork-to-close time is 2898.666416 ms. This is
actual measured work, not a 72-hour claim or controlled performance benchmark.
The shared checkout has unrelated concurrent edits; execution uses only frozen
assets, not those live edits. Only this leaf's assigned subtree is committed.

Final audit SHA256:
`e7aad362679bd528ff3906044ef6105a9804c73bdfbb256929b98bd215bd6f94`.
Final journal SHA256:
`240c7c343623615a3dfd528d785d275abf331fa49fa0d9d07da7008f0e528aa9`.
Individual result hashes and post-run PID checks are in `evidence/final-audit.json`.
`node --check` on the passive audit script and subtree-scoped `git diff --check`
pass. Result/inspection/STOP/journal hashes and all ten PID absences were rechecked
after report preparation; no broad tests, build, typecheck or performance suite ran.

## Historical evidence remains separate

Phase-1 a3d3f77/c1cc8fb/2fae86c and its original report are preserved below, explicitly
historical rather than current unused-budget statements. Independent packed 9/9,
author compiled 9/9 and safe supervisor 4/4 were accepted before this task and were
not rerun. Original compiled 5/5 and packed 5/5, original 7/8 with 16 positive
variants, old twelve executions and old 110/111/profile caveats are unchanged.
The five custom first-read cases remain separate. The retained benchmark is
17.784 ms candidate versus 15.617 ms source baseline, startup included: no overall
win and no rerun. Faraday's global six-data-TS correction is not this leaf's claim.

---

# Preserved phase 1 report: benign green; six targets then unused

## Result and recommendation

Recommend ROOT review this scoped benign result and six-slot design for permission
to proceed, **not** acceptance of default containment. No target was launched.
Execution must WAIT for the explicit root gate. No source/contract fixes identified
or made. Only this new owned directory is committed.

Corrected fixture 8d0909ff3cf29290051e3d91dc3205e629ef6bda independently passes
**9/9 groups on the ACTUAL moved package**, separate from the author's **9/9 compiled**
groups. The four new benign supervisor controls pass 4/4. All five exact owned
children closed with IPC/stdout/stderr closed; the intentional timeout-control kill
and intentional strict late-rejection exit are preserved, not product successes.
No target budget is consumed by those supervisor controls or corrected fixture.

Independent packed PID 14912 exited 0, no kill, empty stdout/stderr, 25896 IPC bytes,
276.133 ms from fork to close. Both native workers loaded the moved package's actual
worker asset, terminated once with termination awaited, and had zero final listeners.
All **25 public exec settlements** were observed before fixture finally/dispose:
zero tracked abort listeners and zero owned worker resources at those boundaries.
The author's 51 boundaries include disposal and are a different denominator.
No worker late errors or strict unhandled rejections occurred in the product replay.

## Exact freeze

- Runtime: 1b133a8662a32ee84524794842074c9c98d5f6c3, including registration 01aa1bf
  and canonical messageerror fixture 1027335. No live dirty product/config used.
- Source: all 216 identities checked against declared commits and frozen snapshot.
- Build: all 704 emitted identities match both snapshot and moved package.
- Archive SHA256: 86c34e382c85563afbd9c760aa2e0f161308e8f43e14fe99dfec9ed96d77539b.
- Source manifest SHA256: ef7d7c018ca19cc699a3ddcd009b8d1197de416f154651885738ce7537369b2e.
- Build manifest SHA256: 9194095150789c25ff250aa746b567aac584d433a6330180f37d4924195a30d9.
- Prepared harness/matrix SHA256: 276b972c3334f0452d26e20fcd0256445f3cbc2dcd43d5b815cbd6d607b1b3b3.
- Independent packed result SHA256: d27d834f2a1b3773ccc8918a95a1b29b838efa48d833c9f3507ad740c233cb99.
- Supervisor result SHA256: 1229baac8c348b8232d12ed0e5187fad3873bd43ca091881a8eba41530ce9931.

`evidence/prepared.json` also hashes public entry, worker, client and protocol assets,
original/corrected fixtures, exact author compiled evidence and original d9e277b
supervision code/evidence. Concepts were adapted, not falsely called exact reuse;
therefore four benign supervisor controls were independently executed before replay.
Own private package.json and node_modules binding prevent the prior 352652a
self-reference trap. Assertion bytes remain unchanged; only the exact fixture
import line becomes bare `virtual-bash`. Compilation is scoped JS emission, not
global type qualification; no root build/test/config changes or broad suite runs.

## Oracle migration and preserved history

Expectations a3d3f77 were frozen before reading the migration handoff/diff, but the
author's first correction commit preceded that commit by 10 seconds. This is not
claimed as preregistration before author publication. Exact later fixture 8d0909f
was compared, frozen in c1cc8fb and independently executed once.

The original fixture and complete diff are preserved. Genuine ShellLimitError
rejection and ordinary handler Error normalization are distinct controls. The new
ordinary control checks status 1/exact diagnostic, and exact one/two cleanup error
objects when cleanup itself rejects. All unrelated original fixture bytes match.
Original 7/8 and historical 16 positive variants remain separate; no relabeling.
Original five 5/5 in both formats remain accepted scoped evidence without rerun.
Five custom first-read controls and 17.784 vs 15.617 benchmark remain separate,
unrerun and unclaimed as a performance win. Old twelve probes remain history.

## Six frozen slots and bounds

Order: grep-default, rg-default, grep-abort, rg-abort, grep-queued-abort,
rg-queued-abort. **All six UNUSED: zero target launches, zero risky matching
executions.** Only four native pathological matching requests are planned.
Queue slots use benign siblings, not extra pathological occupancy requests.
The queue design and admission marker were reviewed statically against frozen
client/grep/rg; queue target behavior has NOT been executed in phase 1.

Single watchdogs: 6000 ms from fork. Queued watchdogs: 8000 ms from fork.
Keep original 1000 ms active/3000 ms startup/two workers and all family limits.
Child heap 128 MiB, stack 1024 KiB; original product worker defaults unchanged.
Output cap 16384 bytes combined, cumulative IPC cap 65536 bytes; one child at a time.
Target kill, protocol error, wrong bytes/status, premature settlement, listener leak
or late error fails and stops the whole matrix. No retry or budget reset.

For queue controls, two benign nonempty responses are held at a trusted real-worker
protocol boundary, then the third invocation's validation request is observed
queued and aborted without touching siblings. Four posted sibling requests comprise
two empty validations plus two benign matches; five pending admissions include the
unposted target validation. Owned-zero at queued settlement permits siblings alive;
all-final-zero is required after sibling completion. This is not catastrophic
matching evidence. Native instruction entry is not instrumented; no universal
preemption, RSS bound, full acceptance or superiority conclusion follows.

ROOT gate schema and exact once-only execution/inspection procedure are in README.
The proposed default/abort expected bytes and identity/timer requirements are frozen
in EXPECTATIONS and child code. There is no new default-acceptance recommendation
without actual gated target evidence and independent review.
