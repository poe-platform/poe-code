# Independent outer-capture review — bounded result

August 29, 2026. **Original25/25; independent7/8. No all-green acceptance or actual
admission GO.** No adapter/product source change, expectation rewrite or retry.

## Frozen composition

- Adapter source/control preseal: `d32cc4d1a9abc9e4064243c3c9070d4df8a51b96`.
- Author evidence: `88036591c32067ffe86a5950198f9f73fbb5cb63`.
- Adapter seal SHA256: `2c53f792822765e3ee582185996922eaf34301adec06bc82974a3f45d038d5c4`.
- Capture body SHA256: `c0b7cac1404f15726d03c4494236be4aa9518fb6a8c645241eeec65cd243f46d`.
- Future owner body SHA256: `6a1bee486d2a2f20ed9b6622660184c38cfb275c94146b131c777e9bf6757372`.
- Unchanged author controls SHA256: `229ad1766aa23a59af739e9f0c788b6600e9fe458aa7daaa5fda325f5e2debe3`.
- Independent preseal commit: `d45473ab`; INPUTS.json SHA256:
  `a6a3f58de6ffb123125637adbb9610f7cb81fe6410bc78e5b65ca0923a423870`.

All seven adapter files and SEAL.json were copied byte-for-byte into `fixture/`.
The unchanged controls use that copy's home for fresh owned outputs. The copied
owner.mjs is authenticated data only: neither it nor the real owner was executed.
Both runners import the exact copied capture body; no runtime body replacement.

This review authenticates32 scoped inputs, including new source/copies, pinned
Node and launcher, and prior receipt references. It does **not** replay d27fd914's
416-file authentication or full offline package qualification. The unchanged
inert preparation `27fd896575280fa96100924cf4f2ecc110710b82` is referenced as data;
target858/comparator955 archive and3843-content-plus-one-instruction-metadata
qualification remain that earlier evidence, not new staging proof.

## Captured independent failure: N02

Frozen expectation: exactly65,537 stderr bytes,65,536 retained, one lost; capture
refused with OUTER_CAPTURE_CAP. Actual:

| Field | Captured observation |
| --- | --- |
| observed stderr | **66,254** |
| retained stderr | **65,536** |
| observed-minus-retained | **718** |
| retained prefix | Exactly65,536 bytes of0x44, independently checked after the failed assertion |
| prefix SHA256 | `dcb3cceeb89595b15abac3233c5871a9dc8d5e4af56443c0c5085386c9b50439` |
| primary | stderr / OUTER_CAPTURE_CAP |
| qualification | false |
| exit and close | signal SIGTERM, code null |
| retirement | PID/group absent; all physical handles closed |

The first equality assertion failed:66,254 !=65,537. There are717 more observed
bytes than the planned producer payload. The718-byte tail is **not retained**;
its contents cannot be recovered or inferred from the counter. No reconstruction
or reclassification to a pass is made. Exact routes:
`novel-evidence/REPORT.json`, `novel-evidence/N02/RECEIPT.json`, and
`novel-evidence/N02/stderr.raw`.

Our `child.mjs` uses a synchronous write loop without an error handler. An
unhandled write error adding runtime stderr is a source-level possibility, **not
a proven diagnosis**: no error code or diagnostic bytes survived in the retained
prefix. The adapter did refuse the overflowing capture and retired the child;
this failure does not establish an adapter counter/acceptance bug. It does leave
the exact65,537-byte stderr holdout unproved. The harness treated it as an ordinary
assertion failure after known cleanup and completed the remaining fixed controls;
there were no additional executions after result inspection.

Root should adjudicate this proof gap before any all-green or actual-admission
decision. A future fixture-only continuation could separately preseal a
cooperative producer and bounded independent full raw tee, but **none is authored,
run, or implicitly authorized here**. Old expectations/results remain immutable.

## Other executed evidence

- **O01–O25:25/25**, one independent execution of the unchanged author controls;
 18 spawn attempts,17 actual harmless children, one ENOENT without a PID.
- **N01 passes:** all three channels simultaneously reach exact64KiB/64KiB/256KiB,
  with distinct expected bytes/hashes and no loss. Actual capture files including
  bookkeeping total395,266 bytes, within524,288; natural exit0, qualified=true.
- **N03 passes:** receipt sync rejection undefined remains selected; receipt close
  physically occurs independently and its null rejection is retained secondarily.
- **N04 passes:** event publication fails after enrollment/listener installation;
  exact sentinel identity, TERM and known retirement precede settlement.
- **N05 passes:** injected invalid write-progress report produces refusal and
  OUTER_CAPTURE_LENGTH. Reported retained0 is explicitly distinct from the one
  physically written byte; the faulty-provider control is not a real-FS defect.
- **N06 passes:** an extra file added after receipt close is refused by the census.
  The durable pre-postguard receipt alone says captureQualified=true but explicitly
  requires terminal confirmation; returned qualification and tested terminal are
  false. Never treat a receipt alone as acceptance.
- **N07 passes:** all five exclusive mode0600 capture files exist before admission
  callback failure undefined; no child is attempted; cleanup completes.
- **N08 passes:** three terminal bytes then thrown0 retain exact reason/prefix and
  never return publication success.

Original negative loss observations are preserved separately: O06 stdout1,
O07 FD3 one, O08 stdout9, O09 stdout6. N02's718 unretained bytes are a separate
new failed holdout, not the historical V6 loss. N05's invalid-progress injected
reported loss is not a trustworthy physical-byte ledger. No aggregate universal
lossless-capture claim is made.

## Source assessment

In the exact capture body, acquisition at line113 precedes beforeLaunch at128.
Enrollment/listeners at136 precede fallible post-enrollment publication; async
channel consumers start at142. Per-channel observed/retained/hash accounting and
bounded short-write progress preserve ordinary backpressure. `settleHandle` at101
attempts sync and close independently for each acquired capture handle.

Receipt publication at203 has separate presence/identity handling and a fallback
close attempt. Namespace/size census at216 and bounded terminal publication at239
can still refuse after a durable receipt exists. The actual owner source at72
uses returned final qualification plus postflight, not merely the stored receipt
flag. N06 is helper/source-composition evidence, **not actual owner execution**.

The owner imports only Node builtins and capture.mjs, then calls captureLaunch
with beforeLaunch=guard. Raw files therefore precede fallible source/tool/AUTH and
launcher authentication. Its own Node startup, static imports or syntax failures
necessarily occur before that code can self-capture; the separate root caller
must retain its small invocation outcome within the admin allowance.

No new capture-body defect was proved. Remaining qualifications are substantive:
checked deadlines do not preempt noncooperative hooks or filesystem promises;
real sync/close failures are only injected here; full257MiB allocation is not
tested; old-space256MiB is not hard RSS. Group retirement of the launched child
does not establish retirement of independently detached inner descendants.
Actual acceptance must reconcile all inner registered ledgers and terminal
publication, not infer cleanup from an outer exit alone.

## Process and evidence accounting

There are **25 test processes**: two runners and23 actual harmless children.
All23 have captured exit/close and independent PID/group absence checks; all real
capture handles closed. The two outer runners have matching captured exit/close
(author0, novel1), no raw-wrapper capture failure and no outer PID-absence claim.
Four developer Git metadata children have matching captured exit/close.
The one ENOENT attempt is not counted as an OS child. No additional PID census.

Review concurrency is one runner/one child. Even conservatively including the
pre-existing shared capture host, nesting is at most three, within the approved
four; the shared service is not invented as a task descendant. Administrative
shell/patch/Git calls are separately bounded by the preseal reserve; total stays
below80. No extra CLI agent/leaf, compiler or real package process ran.

All source/tool/receipt bindings receive postguards. EVIDENCE-MANIFEST.json binds
exact retained files, sizes, hashes and capture-time modes. Git preserves bytes
but not the difference between0600 and0644; mode evidence refers to the actual
capture/manifest, not a promise about a later checkout's data-file permissions.

The pre-test source-reader refusal on a194,476-byte prior receipt is separately
preserved in metadata/SOURCE-INSPECTION-NOTE.json. Its100,000-byte text limit was
not a runtime/capture failure; the receipt was hash-bound without decoding or
rerunning416 old checks. All metadata children had already closed; no retry.

## Conditional future route — no activation

The dedicated owner replaces the planned owner slot. Future source callgraph:
owner → launcher → coordinator → one worker → one Git metadata child. The
predeclared total is47 runtime processes (owner/launcher/coordinator,14 workers,
30 metadata children) plus8 admin = **55**, peak **5**, on the complete planned
route. These are planning counts, not observed production/kernel measurements.

An exec-replaced launch shell does not remain an additional concurrent parent.
A newly owned waiting Node/shell wrapper would add a sixth process and violate
that selected topology. An existing shared tool service is not automatically an
owned task descendant. Root must select the concrete exec/direct launch route,
all-process cap and startup-outcome capture, not inherit this review's budget.
The inactive metadata's128 all-process cap is a future proposal/reference, not
actual authorization granted by this review.

Prospective partition:257MiB = unchanged inner248+8MiB, outer512KiB,
publication/admin512KiB. Outer partitions are stdout64KiB, stderr64KiB, FD3256KiB,
intent16KiB, events48KiB and receipt64KiB. Terminal≤8KiB is charged to admin, not
an additional allowance. Actual owner uses75min checked total, reserving2s TERM
and1s KILL; inner worker30s and metadata10s/64KiB remain unchanged.

The authoritative prospective command is the **owner.mjs** file/argv vector in
the new INACTIVE-GRANT-METADATA.json. The older inactive AUTH template still ends
with prose saying launch.mjs; that stale instruction must not bypass the new
owner. This is an operator-route clarification, not a changed13-field schema.

Keep all seven sealed files, their inactive/null metadata and SEAL.json unchanged.
Fresh grant/AUTH belong only in the separate activation paths. Do not fill the
sealed INACTIVE metadata's null placeholders or change actualAuthorized:false.
The owner still pins AUTH.review to d27fd914's exact receipt; this adapter review
must be bound separately by the fresh root decision, not substituted into that
fixed field. No active grant, AUTH or new positive machine acceptance receipt is
created by this review.

Actual payload staging/installed+moved loads, inner authority, two C11 setups,
full evidence census and admission remain unrun. The99 semantic cohort needs
another grant. Old HOLDs, consumed grants, V6's294045 irrecoverable bytes and W07
UNQUALIFIED/UNCREDITED status remain unchanged; no engine win or latest claim.
