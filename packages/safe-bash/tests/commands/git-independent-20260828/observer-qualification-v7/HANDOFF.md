# v7 narrow successor — PARTIAL HOLD, no retry

Friday, August 28, 2026. Preseal commit:
`b83c2f27d2cd6d6a15c0b1570b1a067bac740e6b`.
Evidence commit is reported separately in the final response; no self-referential
commit field is invented. **Qualification is NOT complete. No candidate or
284-group continuation is authorized or executed. No product fix is justified.**

## Actual membership and result

Frozen19 rows = original6 real + original10 synthetic + original2 source-data
controls + ONE focused synthetic S11. No original input/expectation row changed.

| Rows | Prior v6 | Actual v7 |
| --- | --- | --- |
| R01 | PASS | PASS, explicitly a repeat |
| R02 | FAIL, callback-only surrogate cleanup timeout | PASS with source-correspondent close fallback and authorized operation criterion |
| R03/R04 | UNEXECUTED | PASS/PASS |
| R05 | UNEXECUTED | FAIL: frozen expected PASS, actual terminal HOLD |
| R06 | UNEXECUTED | UNEXECUTED |
| S01–S10 | UNEXECUTED | UNEXECUTED |
| S11 | Not in v6 | UNEXECUTED |
| D01/D02 | UNEXECUTED | UNEXECUTED |

Actual:5 real attempted,4 passed,1 failed;0/11 synthetic and0/2 data controls
executed. Fourteen total unexecuted. Preparation/audit source checks do not count
as D02 qualification execution. This was the ONLY cohort; no single-case retry.

R02 and R04 record raw writePending=1, an actually rejected/SETTLED writer via
close-fallback, ownedOperationPending=0, fulfilled cleanup and closed/delivered
close. Raw callback absence is diagnostic, no longer confused with a pending
owned operation. This does not rewrite the original v6 R02 failure.

R05 settlement: closed=true, destroyed=true, closeDelivered=false; writer fulfilled
through write-callback; ownedOperationPending=0; cleanup fulfilled; hasFailure=false.
At the finite horizon, close is delivered, but an `AbortError`, code `ABORT_ERR`,
message `The operation was aborted`, arrives AFTER settlement. It is a different
object from the declared header-refusal primary and was not in the accepted
identity set. Frozen criterion only allowed the R05 iterator AbortError instance
if observed before settlement. It remains late=true, acknowledged=false,
hasFailure=true. The exact assertion is **'HOLD' !== 'PASS'**.

R05's actual known-resource cleanup safety field is false; it is NOT a pending
cleanup/unknown-process-closure stop. Its failed expectation ends the worker;
the supervisor's aggregate safety=true also covers this incomplete failed cohort.
Do not reinterpret the failure as a passing negative test. The late-error guard
was not weakened or silently bypassed. Whether/how an intentional iterator-close
error can be bound to an explicit expected identity before outcome is unresolved;
this run makes no such claim and performs no post-stop repair.

## Source correspondence

`CORRESPONDENCE.json` authenticates the immutable codec source at
`9885390fb11454fa194a3e60fdbef198dbfdf633`, path `src/commands/git/codec.ts`:

- Full blob OID: `02ad268a05e6e88edae8410c73328a65ac82d3e3`.
- Full blob SHA256: `442bd6956340565599afcc1e0762eb7a8d8e001fe8880e9ec8185b1e200bd868`.
- Writer: source lines33–52, exact byte interval[1259,2252),993 bytes;
  SHA256 `9b54d9f0b5cc73cf776b45b8c57fbc27a7f1acd8ca165306836a1b4760ed1fd6`.
- Four enumerated TYPE-only erasure rules, with exact occurrence counts. No
  source writer statement/order/Promise implementation changed. Error listener
  differs only in receiver parameter name. First-error flag/identity, listener
  registration/removal, close fallback, nullish normalization and idempotence stay.
- Generated isolated surrogate SHA256:
  `94b2d6b48b5981e2df17e69b5b5109a7cfe8c8e42a13692ff25badca95fa0f5d`.
- Observer v7.1 SHA256:
  `43c4bbb26c152e8e73b85b8ab4c38bcd438a424cbdfe517403daaf8721033d8d`.

This is the user-authorized isolated writer body on small independent inputs,
not a product module import/transpilation, whole-codec execution or Git invocation.
Session scheduling/budgets/cancellation are not qualified by its small no-op stub.
The v6 exact official Node22.22.2 sources/docs were reused as authenticated DATA,
with zero new network requests. No private-handle/native allocation/RSS/workerpool
preemption or all-future-late-error guarantee is claimed.

## Bounds, guards and closure

One sequential direct worker; one coordinator; peak2 known owned processes.
Syntax children0; separate control children0; candidate/build/native Git/private
children0. Preparation logs5 Git metadata children and1 apply_patch helper; audit
logs its metadata commands separately. No OS-global census or descendant claim.

Worker PID34736, parent34734, birth187199890964416ns; exit1, signal null. Exit,
ChildProcess close and both pipe closes are observed. Immediate known-handle
enrollment precedes fallible helpers; finally cleanup settles. No signals sent.
Supervisor also returns naturally with code1. All five real streams report
fulfilled known-owned cleanup and no pending owned operations at the horizon;
this does not establish native allocation lifetime.

Run starts2026-08-28T19:03:06.417Z. Through cleanup/postguards/pre-receipt sample:
278.914708ms. Post-receipt publication sample:282.281375ms, below600000ms;
the final clock-file write itself is the disclosed unsampled tail. Worker14.56475ms.
Raw stdout96602 bytes, stderr0; capture directory including receipts100707 bytes;
owned content before publication237069 bytes. Final publication bytes are audited.
Caps remain32MiB capture/128MiB scratch; these are file bytes, not peak memory.

Preparation is separate: first reliable wall18:54:16Z, freeze19:02:08.791631Z,
472791.631ms wall elapsed; preparation script423.93825ms. No old110-minute budget
or claimed72-hour work duration is inherited. Admission/commit time before RUN
is not mislabeled as measured qualification work.

Pre/post guards preserve all v5 files25 and v6 files17 plus its RUN-01 directory;
this version checks full file/directory census, including new empty directories,
and rejects symlinks. Node executable and every sealed v7 input hash match.
Audit reauthenticates the preseal from Git and repeats those data-only checks.
The literal DIFF-V6.patch is a captured unified diff: git diff --check reports11
single-space context lines inside that DATA file. Those context markers are
preserved; no claim of a clean whole-diff whitespace check is made.

## Authorization and preservation

All old v5/v6 bytes, v6 failure/16 unexecuted rows, and v5 original289/288,
69 semantic passes/H09 STOP/215 remaining layout groups are unchanged. The new
harmless traces cannot re-score old missing states. Six native Git workflows
remain held. API/types/mutants/package/layout acceptance receives zero new credit.

ROOT requested a new284-group continuation proposal only after SUCCESS. That
condition is unmet, so no new continuation seal/adaptor is promoted here. The
earlier all71-fresh-source + original14-other-children recommendation remains
an unapproved proposal, not authority. Artifacts are ready for DIFFERENT review
of this partial failure, not self-certified candidate continuation. Only new v7
paths are committed atomically; concurrent foreign staging was preserved.
