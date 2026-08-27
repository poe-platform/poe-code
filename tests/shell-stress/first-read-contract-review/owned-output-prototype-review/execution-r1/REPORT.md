# Immutable v1 independent execution-r1

**Corrected executable binding: 16/16 frozen logical cases pass. Initial binding:
15/16, with H12's original failure retained and independently diagnosed. Unchanged
original five: 1/5, not 5/5. No production approval; release remains RED.**

This leaf used only its assigned new evidence tree and
`/tmp/safe-bash-owned-output-prototype-review-execution-e9I2ro`. No delegation,
live source fallback, author-source changes, root build/configuration/dependency
changes, current global typing, full suite, new native breadth, or v2/new-reviewer
holdout inspection occurred. Root's ready marker authenticated the v1 author as
actually CLOSED/code0 at evidence commit `1ff82cb748c60145740dba354610ac7ed7a7f15f`.
The preparation's 0/16 product executions and six scaffold assertions remain
separate from these executions.

## Authentication and binding

The fresh reconstruction restored the inert baseline archive, checked every
baseline file, applied the authenticated source patch in the temporary copy,
verified all 213 source and 14 test entries, then rebuilt all 708 compiled files.
Every compiled entry matched the handoff. Existing Node/development tools and
the known native tools were authenticated against their recorded hashes.
`source-alignment.json` repeats the full per-file checks after every execution;
there is no candidate source/test/compiled drift. The 11 accepted original test
and helper inputs retain their exact archived hashes.

| Identity | SHA-256 |
| --- | --- |
| Original independent intentions seal | `aabc0ea5c7d7f03b4c4038b3c94952e7a08d9c98e2d40b9dbbf76417503be972` |
| Original separate binding seal | `ed00497a9503623e51922f3d0b65ed15aec5a5c03608d06f265e223cb923b8b1` |
| Candidate 213-source manifest | `c13d21a4205f75a846363e7e2c13db103ed841ee61397553105745c940f31c44` |
| Candidate 14-test manifest | `bdae375b37ea07dcbbd505a23873d472cfd379eae70f0b037d82b9830046de44` |
| Candidate 708-compiled manifest | `c4df1c6910557948441eb47b3b7a9a9d069267e14e3745541f5d1e8c6d766bb0` |
| Initial executable-input manifest | `d61371b6621dae6db0bfd2857114563b805a6cc7257d4b71a36d2cffa9a327e8` |
| Initial binding seal file | `5de357198847410855f0fadda72e75ce1c1745c02fafdef22418b6f00e0a6222` |
| Initial executable H01/H06-H16 | `89e7126e946dd8eee07e547891bd83ba5db15a28f22890bbce6fa31e99a1fd98` |
| Corrected executable H01/H06-H16 | `c8a139b02533c8c964fef8eea829532a528fe85cbfa7d660bc8109e0c17ddd09` |
| Exact focused binding delta | `e07dcfd2f7cf2d4d3dee9671afeeddf9c8e1a106568d7a23e109661c13b8ef24` |

The assignment's binding digest omitted the leading `ed`; full bytes matched
immutable `044aaaca` and the prior REPORT. The initial authentication failure is
preserved in `authentication-first-failure.txt.data`; no frozen file changed.

`binding-seal.json` sealed imports, inputs and assertion instrumentation before
execution. H01-H05 reuse the authenticated author's exact adapted-original
fixture, independently checked against the original and frozen requirements,
with imports rebound to actual compiled v1. Helpers and MockDav likewise import
compiled v1. `old-to-bound-adapted.patch-data` preserves the entire old-to-adapted
delta, including the local producer's explicit enrollment and changed signal
observations. The frozen H01 effect probe runs separately through actual Shell.
H06-H16 use actual compiled Shell, curl, VFS, BytePipe and invocation APIs, not
the old scaffold's fabricated observations. No root export was invented.

## Exact denominators

| Cohort | Result | Qualification |
| --- | --- | --- |
| Accepted historical baseline original five | 0/5, all 1200ms | Archived `3eba797a`; not rerun as a new baseline here |
| Unchanged original five on immutable v1 | **1/5** | S3 passes; local deadline and three original stage assertions fail |
| Adapted original five on compiled v1 | **5/5** | Both initial and corrected executions; not unchanged-original passes |
| Frozen independent logical cohort, first binding | **15/16** | H12 fails one of its five subruns |
| Frozen independent logical cohort, corrected binding | **16/16** | All sixteen actually rerun; five adapted + eleven new |
| Existing controls | **57/57** | 1 head-zero + 19 remote + 28 byte IO + 5 shared + 4 streaming |
| Accepted C1-C9 controls | **9/9** | Legacy filenames say baseline; actual target is restored v1; C9 is synthetic/non-product |
| Known native effects | **5/5** | Only authenticated GNU Bash 5.3/Darwin profile and C3-C7 inputs |
| Independent H12 diagnosis | 4/4 diagnostic subruns | Not added to sixteen or any other product denominator |

Source build, copied source/test typecheck, bound-fixture typecheck and initial/
corrected JS syntax checks all exit 0. The copied source/test compiler inventory
contains exactly 357 entries and matches the authenticated inventory after only
temporary-root normalization. Legacy 57 use unchanged copied TS inputs; the nine
controls and independent sixteen bind compiled v1. No current checkout gate is
implied by either execution mode.

The full owned `git diff --cached --check` reports trailing whitespace only in
verbatim TAP failure output and unified-patch blank context lines. Those bytes
are intentionally preserved, not normalized. The separate maintained-code/docs/
JSON check passes; no repository whitespace configuration or exclusion changed.

## Sixteen frozen logical cases

| ID | Initial | Corrected | Actual checked behavior |
| --- | --- | --- | --- |
| H01 | PASS | PASS | Adapted local first read; separate frozen probe completes VFS/stderr effects after owned EPIPE, stage/caller live |
| H02 | PASS | PASS | Actual mock S3 transport gets owned signal; one next, one return, zero active, zero writes |
| H03 | PASS | PASS | Actual WebDAV PROPFIND/GET; one GET before close, zero writes, request closed before teardown |
| H04 | PASS | PASS | Actual curl body-pending GET canceled before first write; stage/caller live |
| H05 | PASS | PASS | Actual curl pre-response request canceled before headers/first write; no lazy zero-request pass |
| H06 | PASS | PASS | Actual nested consumers retain shared first/remainder bytes; no premature underlying return |
| H07 | PASS | PASS | File/stderr effect, empty completion, delayed error under default/pipefail, diagnostic then 141 |
| H08 | PASS | PASS | Actual nested invoke: stdout-owned cancellation does not cancel separate stderr/file operation |
| H09 | PASS | PASS | Curl stdout headers with body file; exact 18 body bytes after preheaders stdout close |
| H10 | PASS | PASS | Curl stdout body with header file; exact captured header block retained |
| H11 | PASS | PASS | Curl both files plus write-out stdout; both independent files finish |
| H12 | FAIL | PASS | Caller object/zero identity, selected public execution rejection, sole and aggregate cleanup failures |
| H13 | PASS | PASS | Closed admission, refused late invoke, opaque late rejection, exact-once release and overlapping disposal |
| H14 | PASS | PASS | Empty/writing normal completion stays distinct from reader close; selected failure remains 7 |
| H15 | PASS | PASS | Write-only sink honestly lacks notification; ordinary write works; same command cancels on real pipe |
| H16 | PASS | PASS | One-byte queue accepts A without demand, B blocks then rejects exact caller reason; owned chunk copy and noncircular Shell start barrier |

Every adapted original preserves its command spelling, payload/setup, one-start
middleware barrier and 1200ms bound. Observations are one read/request, one
resource return, zero active work and zero first writes; EPIPE is operation-local.
HTTP GET-entry counts are requests, not iterator-next counts. For H09-H11 each
default/pipefail subrun starts exactly one authorized loopback request before
stdout close, retains required files and emits no unexpected diagnostics. Actual
curl producer status is 141; pipeline status is 0 by default and 141 under
pipefail, inside the unchanged frozen admissible set. Corrected runs retain raw
server socket-write bytes/base64 and compare header files with that exact header
block. The response has Date disabled and deterministic Connection: close.

## Original five: exact failures and assertion reach

`evidence/runs/original-five-and-head-zero.*` preserves the unchanged run, including
each child's full stdout/stderr and the original 1200ms inner/3000ms outer/1MiB
bounds. Four failures are not merged into a generic timeout description.
`old-to-diagnostic.patch-data` adds only passive observations and assertion-entry
markers to a separate compiled-bound copy; every original assertion text remains.
The diagnostic rerun is not substituted for the unchanged input run.

| Original | Actual failure or success | Before teardown / assertion reach |
| --- | --- | --- |
| Local | `DEADLINE: first-read-local (1200ms)` | One next, active 1, return 0, zero writes; stage/IO/caller live. No result/abort/cleanup assertion reached. |
| S3 | PASS | Original observer already receives IO signal from source factory. IO EPIPE, stage/caller live; one next/return, active 0; all assertions reached. |
| WebDAV | `assert.equal(observed?.aborted, true)` at original line 103 | Result 0, empty streams and caller-live assertions pass; observed stage is false while actual IO is EPIPE. One GET, active 1, return 0 at failure. |
| Curl body | Same original stage-aborted assertion | Request has sent headers but no body; stage/caller live, actual IO EPIPE. One request, active 1, return 0 at failure. |
| Curl headers | Same original stage-aborted assertion | Request started without response headers; stage/caller live, actual IO EPIPE. One request, active 1, return 0 at failure. |

For the three stage-assertion failures, original reason-code, bounded-close,
read/return/active and later unhandled assertions are **not reached and are not
credited**. In the separate diagnostic, stage and caller are live at IO abort;
post-teardown observations are return 1/active 0 for all five. Teardown explicitly
aborts the caller and is never credited as acceptance rescue. Adapted remote
fixtures separately wait for their existing bounded peer-close assertion before
teardown; peer-close may occur after public exec settlement. This does not prove
that exec waits for every remote peer or opaque host promise.

Known command integrations can enroll work because they know its ownership:
v1 cat's named-file path and curl's destination analysis bind an operation to the
actual output sink before IO. An arbitrary pending-stream handler exposes only
opaque host work with the stage signal; the shell cannot infer exclusive ownership
or safely abort independent effects. Its unchanged local timeout is therefore
distinct from the three obsolete stage-signal expectations. The explicit adapted
producer provides the missing ownership. Borrowed/transitive behavior under the
separate new direction is not inferred from, or retrofitted into, this cohort.

## H12 first failure and one focused correction

The initial harness threw `{failure: 'execution'}` from middleware and incorrectly
assumed this was a selected public execution rejection. Four independent compiled-
Shell diagnosis subruns prove the ordinary object is converted to status 1 with
exact `shell: line 1: [object Object]\n` diagnostics. With cleanup failure, that
completed result correctly yields the cleanup rejection. It was a binding error,
not evidence of a v1 precedence bug.

The same middleware throwing the inspected public `ShellLimitError('maxCommands')`
produces a selected public rejection whose identity survives with and without
cleanup failure. The corrected binding uses that object while retaining the exact
identity assertion and all five frozen H12 subruns. `binding-r0-to-r1.patch-data`
and `binding-r1-seal.json` seal this before the corrected execution. That one round
also adds raw HTTP byte observation and an explicit same-dispose-promise assertion;
it changes no frozen intention, fixture constants, status set or candidate source.
Initial raw H12 failure and the four diagnostic results remain beside corrected
results. Authentication-digest transcription and post-run TAP-report parsing
errors are separately preserved; neither was a product-test assertion correction.

## Closure, scope and reproducibility

All 68 supervised captures observe close, absent PID and absent process group,
with no outer deadline/output kills and no SIGSTOP. Original child wrappers also
report no residual groups. The reconstruction compiler exits 0 and is reaped.
Mixed-output servers close with zero tracked sockets. No optional mutations were
run; the prior six scaffold assertions are not mutation/product-kill evidence.
Recorded artifact creation through final verification is August 27, 2026,
10:04:53–10:17:35 UTC; this is bounded recorded work, not a 72-hour claim.

Only evidence files are committed. All source/test executable copies live in the
unique temporary tree; repository code captures end in `.data`/`.patch-data` and
add no test-discovery files or exclusions. Concurrent foreign staging/worktree
changes are observed only as metadata, never staged or committed by this leaf.
This result does not certify a later revision, deployed service, broad Bash
superiority, full gate or release. A different assigned candidate needs its own
actual execution.

Reproduction entrypoints are inert `restore.mjs.data`, `prepare-binding.mjs.data`,
`run.mjs.data`, `h12-diagnosis.mjs.data`, and `correct-binding.mjs.data`. Run restore
from the repository with `node --input-type=module < .../restore.mjs.data`; it
prints a new owned temporary root. Pass that path as argv[2] when streaming the
prepare/run scripts (`node --input-type=module - "$TMP" < ...`). Preserve the
initial raw run before materializing/running the separately sealed diagnostic and
correction. Bound executable copies, exact patches, complete capture logs and
per-file hashes are included; no live-source reconstruction is necessary.
