# Final independent owned-output direction execution

**FAIL / partial qualification: 3/7 new logical cases pass. All seven ran.**
D01, D02, D03 and D07 retain their failing criteria. D04, D05 and D06 pass
this frozen binding. D07's four subruns all ran and all fail the zero-return
criterion; they are not four additional cases. No candidate source was fixed,
no expectation was weakened, and no production approval or release is implied.

## Candidate and chronology

Execution used a fresh writable reconstruction at
`/tmp/safe-bash-owned-output-direction-review-final-replay-Uqm6aX/candidate`,
not the read-only author candidate or live source. Durable author restoration
was changed only to use this leaf's temporary prefix and leave its new copy
writable. Its retained proof's final descriptive note still says read-only;
`candidateReadonly: false` and the recorded restoration delta are authoritative.
Both intermediate v1 and final v2 source/test/build identities were checked.

| Authenticated v2 material | Count | SHA-256 |
| --- | ---: | --- |
| Source manifest | 213 | `2896bd6108a90e19abee682db729960cc85f71d0ecd15562e4f9cb93b5f3399c` |
| Test manifest | 15 | `f56d1acc3973bd82697d888fa68a9a7f92acffd24ece75351062ee3cba9984c7` |
| Compiled manifest | 708 | `c8bfd5130b2317c5dabc321791b08211d9a5d689865fdeb1b90916efd23f5543` |
| Handoff | 1 | `fb04617552411603080dc4ab0bd34388576b8a1e523c31d0b410f11f7f3c1299` |
| v1-to-v2 source patch | 1 | `c38b2327df4baea4df3ff8ec7186e797ce79d9f6da18a32da402cd967dd00b2c` |

All 358 compiler inputs, existing Node/development tools, final copied build,
and final copied scoped typecheck match. Post-execution source/test/compiled
manifests remain identical. `authentication.json`, `source-alignment.json`,
`reconstruction-proof.json` and both captured ready files supply exact inputs.
The complete executable was sealed at **2026-08-27 10:37:09.691 UTC**, before
first product-case execution. New intentions remain the original `eb78897`
freeze, SHA `eb2fde0beb13aeb738019309c6db9ec8aa4ab9694a82d3f35efc1cbfae0527ae`.
The parent's and partial binder's previous **0/7 executed** reports are untouched.

Independence is qualified, not guaranteed blindness. Root reports a brief
misrouting of verifier binding notes around 05:16 Chicago, then private
relocation at 05:16:22 on August 27. Independently fetched commit `630bf76f`
is timestamped **05:13:42-05:00**, before the reported exposure. Its source
patch and author-fixture hashes exactly match the final handoff. The author
reports no independent-test-body reads; this is not root proof of unobserved
activity. No source change is attributed to exposure without evidence. This
executor did not inspect the author's eight test bodies to design its tests.

## Exact new-seven results

| Case | Result | Actual decisive observations |
| --- | --- | --- |
| D01 active borrowed curl, full cursor | FAIL | Prefix delivered, second read pending before actual stdout close, zero first writes, stage/caller live. After release curl consumes all four chunks plus EOF, opens zero requests, uploads zero bytes, exposes no handback, leaves empty sibling/owner tails. Return/cancel/close counts all zero. Curl producer status 141; final `; true` pipeline status 0, empty stdout/stderr. Four original byte/suffix criteria fail. |
| D02 opaque read | FAIL | Public operation/exec settles while actual opaque read remains active. Controlled release commits exact `late-owned-read\n` to the real VFS record; sibling/owner bytes are exact. Three underlying return calls violate zero-return, with no cancel/close and no concurrent next. |
| D03 exclusive transfer | FAIL | Explicit transfer precedes exactly one read. Shared cooperative close/dispose wait for the gate; owned release occurs once, active count becomes zero. Independent file and unrelated borrowed bytes are exact before disposal. Unrelated source receives one top-level-exec return, violating zero-return. |
| D04 parent/child/grandchild | PASS | Actual stdout close propagates transitively, all three late acquisition callbacks are refused with the same selected reason. Registered cooperative acquisition/child cleanup gates hold the parent drain. Child completion does not remove the gated grandchild. Each owned resource releases once; real admitted VFS resource is removed. Outside-tree file and stderr exact, stage/caller live before deliberate disposal. |
| D05 child isolation | PASS | Stdout child closes without aborting parent, file sibling, stage or caller. Fresh parent/sibling acquisitions and both exact VFS writes succeed; independent stderr exact. |
| D06 active mixed curl | PASS | Actual second upload read spans stdout close. One loopback request gets the exact full upload. Exact 16-byte body, exact frozen header block and independent file/stderr complete. Curl producer 141 for redundant writeout, final pipeline0, empty stdout. No borrowed return/cancel/close; zero sockets before forced fixture teardown. |
| D07 reason/cleanup/late errors | FAIL | All four fixed subruns preserve selected reason/error identity, await each registered child cleanup once and retain survivor bytes, but each makes two underlying return calls. No cancel/close or unhandled rejection. |

Each initial result, including every failing criterion, is in
`runs/new7-r0-D01.json` through `runs/new7-r0-D07.json`; parsed observations
and exact VFS strings are retained in `results.json`. These raw initial
results are not retroactively corrected by diagnostic replays.

### D01: consumption, commitment and the streaming tradeoff

The public API declares neither a per-read lease nor handback/rollback; the
pre-execution binding therefore selected the frozen opaque branch. The full
four-chunk cursor was visible to actual curl. There were no host-supplied
one-chunk frames, artificial EOF, private replay buffer, or invented handback.
The pending read was controlled by the fixture, not presumed preemptible.

At `src/commands/network/curl.ts:163`, v2 collects stdin up to
`maxUploadBytes` before enrollment. Enrollment at line 180 immediately sees
the already closed stdout; line 195 prevents network work. This delays
request start and replaces stdin-upload streaming with bounded prebuffering.
File-only uploads retain their separate streaming path. A consumed chunk is
neither transmitted nor rolled back in D01. Author one-chunk partition evidence
does not establish this frozen full-cursor property.

Ordinary `curl --data-binary @-` commands consumption of the entire finite
stdin; full consumption alone is not a general curl parity defect. D06
demonstrates the legitimate whole-input mixed-output case. D01 imposes the
stronger frozen requirement that already closed stdout-only work not drain
the future owners' suffix and that consumed prefix/late bytes be committed
or handed back. Current v2 demonstrably fails that requirement. The result
is a design/profile gap, not proof of standard curl corruption, nor a reason
to waive the frozen test. No unbounded-host prompt-cleanup claim is made.

### D02/D03/D07: top-level stdin ownership conflicts

The additional zero-return failures are **not attributed to stdout-local
operation cancellation**. The explicit binding passes an arbitrary cursor
as top-level `Shell.exec({stdin})`; this API has no borrowed-ownership flag.
`ShellInput` marks such a source owned (`src/shell/input.ts:80`), and exec's
finally closes it (`src/shell/shell.ts:181`). Closure before observed EOF
calls the underlying return (`src/shell/input.ts:65`). Instrumented actual
calls all identify compiled `dist/shell/input.js:73:80`.

D02 has one return while its direct opaque read remains active, plus one
per subsequent top-level one-chunk consumer. D03 has one at the unrelated
consumer's normal exec completion. D07 has one from failed exec and one
from its separate live owner exec; in its execution/aggregate variants the
first call occurs with the opaque read still active. Those return calls do
not prove that the pending read settled or was drained.

The input and Shell source files are byte-identical between authenticated
v1 and v2. This is a stronger frozen zero-return/cross-exec profile conflicting
with the selected public stdin binding, not evidence that v2 newly introduced
global stdout cancellation. No new borrow API is invented. The fixture's
return hook records calls without destroying remaining data; therefore exact
survivor bytes in this instrumentation cannot certify a destructively closed
real source. The zero-return criterion still fails in every affected case.

D02's independent late VFS commit is an explicit command effect, not hidden
restoration or a product rollback guarantee. D03's transfer is explicit host
ownership plus registered cooperative cleanup, not inferred from an iterator
or signal. D04's registered cleanup covers the admitted cooperative acquisition;
`acquire` alone does not promise to await every opaque host acquisition.
D03/D04 deliberately overlap disposal only after independent effects, so
their public execution rejects `Shell is disposed`; it is not relabeled
normal success. All corresponding cleanup settlements are awaited.

### D07's four fixed subruns

| Subrun | Selected public result | Unchanged failing observation |
| --- | --- | --- |
| caller-object-with-child-cleanup-failure | Exact `{code: EPIPE, marker: caller-not-output-close}` object identity | Two source returns |
| caller-zero-with-child-cleanup-failure | Exact primitive `0` | Two source returns |
| execution-rejection-with-late-opaque-rejection | Exact public ShellLimitError with frozen message | Two source returns |
| two-child-cleanup-errors-with-late-opaque-rejection | Public aggregate contains both child error identities | Two source returns |

For execution/aggregate variants, controlled opaque rejection occurs after
public settlement and is observed by exact identity. Caller variants resolve
their controlled read. Each child cleanup runs once. Each separate owner
invocation receives exact `reason-owner-survived\n`. No generic cancellation
status substitutes for caller or selected-error identity. The selected
ShellLimitError is bound before execution; ordinary middleware errors are
not falsely treated as public rejection paths.

## Sealed old cohorts on the same v2

| Cohort/profile | Actual result | Denominator discipline |
| --- | --- | --- |
| Old16 initial binding | 15/16 | Original H12 binding still fails; never retroactively green |
| Old16 separately corrected binding | 16/16 | Exact sealed corrected driver, no new expectations or source credit |
| Original five | 1/5 | S3 passes; local timeout and three stage-abort assertions fail |
| Adapted five | 5/5 | Separate owned-output IO-signal profile |
| Existing legacy | 57/57 | 19 remote + 28 byte-IO + 5 shared lifecycle + 4 streaming + original head-zero control |
| Review controls | 9/9 | C9 synthetic timing control, not product behavior |

Old16 drivers are byte-identical to commit `49055fd`:
initial SHA `89e7126e946dd8eee07e547891bd83ba5db15a28f22890bbce6fa31e99a1fd98`,
corrected SHA `c8a139b02533c8c964fef8eea829532a528fe85cbfa7d660bc8109e0c17ddd09`.
Their relative `./candidate/dist/index.js` import now resolves to the fresh
authenticated v2 tree; the driver textual path delta is empty and separately
hashed in `source-alignment.json`. This is explicit source-identity rebinding,
not a changed case. Shared H01–H05 compiled adapted runs serve both profiles;
the additional H01 separation check remains within H01, not a seventeenth case.

Historical initial15/16 and corrected16/16 on v1 remain separate in
`historical/v1-results.json`. All four v1 H12 diagnostics and the exact
correction delta are retained. An ordinary middleware object becomes status1
and `shell: line 1: [object Object]\n`; with cleanup failure the cleanup
rejection wins over that completed command result. The authenticated public
ShellLimitError survives by identity with/without cleanup failure. That is
binding correction evidence, not a candidate source fix.

Original baseline **0/5 at 1200ms** and unchanged v1 **1/5** are historical,
not new measurements. The known native-five reference is retained without
new native breadth. Original/adapted cohorts and legacy/control denominators
are never combined into a claimed expanded acceptance corpus. Original
stage-assertion failures leave subsequent original assertions unreached, not
implicitly passed. No passing adapted test rewrites an original failure.

## Harness limits, diagnostics and closure

All 63 supervised captures close normally with absent child PID and process
group, no deadline/output kill and no SIGSTOP. New cases use 1200ms phase,
5000ms process, 262144-byte output and 64-event/512-byte-event bounds. D01
and D06 show zero sockets before fixture teardown and after server cleanup.
Controlled opaque gates settle under fixture control; this is not universal
host-work drain. No installs, root dist, global typing, full suite, release,
native expansion, source fix, or optional mutation corpus was run.

Syntax, the actual declared-API TypeScript binding, copied scoped source/tests,
and old compiled-bound TypeScript checks pass. The dynamic JavaScript driver
is syntax-checked, not falsely described as fully statically typed. The first
callsite-only diagnostic used an undefined `owned` identifier; ShellInput
swallowed its return-hook error, so it provided counts but no callsite evidence.
That first failure is preserved. The second, presealed diagnostic removes
only that identifier and records actual return callsites. Neither changes
inputs/assertions/results, and no further harness-fix round was used.

`runs/*.json` retain raw stdout/stderr strings/status and full child metadata.
`raw/*.json` additionally preserve exact UTF-8 bytes as base64, lengths and
hashes, including empty streams. Temporary `.stdout.data`/`.stderr.data`
materializations can have a terminal newline from apply_patch and are not
the byte-authoritative capture. JSON captures are authoritative. VFS effects
are exact strings in case records, not inferred from exit status alone.

Recorded owned artifacts begin August 27, 2026 at 10:31:05.578 UTC; result
synthesis is at 10:43:43.360 UTC, with later documentation/validation recorded
separately. This is bounded actual work, not a 72-hour completion claim.
Only this new evidence scope is committed. Foreign index/worktree and native
artifacts remain outside ownership. Root must observe actual executor CLOSED;
this report cannot certify its own process closure.

Staging initially refused the inert captured `source-reference/dist/*.data`
paths because of the existing global `dist` ignore rule. Only these owned
evidence paths are force-staged; no ignore/config change is made. The all-path
whitespace check flags line 13 of the immutable historical H12 patch (the
required space-only diff context prefix). Its authenticated bytes are preserved.
All other owned paths pass whitespace checking, including every canonical
source/test/helper capture. Both issues are recorded separately from product
and harness outcomes; neither earns a pass or source-fix credit.

## Reconstruction

From the repository, stream `restore.mjs.data` to existing Node with
`node --input-type=module < .../execution-final/restore.mjs.data`. It creates
a unique allowed temporary tree and prints its path. Existing `apply_patch`
must be on PATH. Stream `prepare.mjs.data` with that path as argv[2]; it checks
the immutable author/old/new materials and freezes executable bindings before
execution. Materialize `run.mjs.data` into that temp with apply_patch and run
it as `run-final.mjs`. It performs the seven real cases and unchanged sealed
replays. A nonzero test status is expected for retained failures.

The callsite diagnostics are optional reproductions of attribution, not new
cases or pass corrections; preserve r0 before running `diagnose.mjs.data`
and `diagnose-r2.mjs.data` as temporary modules. `finalize.mjs.data` captures
outputs and verifies unchanged identities. All executable repository payloads
end in `.data`/`.patch-data`; no new raw test-discovery fixtures are added.
The final result is an honest failed/partial profile, not a request to fix
the prototype or approve production.
