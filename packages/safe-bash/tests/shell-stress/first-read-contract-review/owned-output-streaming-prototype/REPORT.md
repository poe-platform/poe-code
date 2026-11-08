# Reduced streaming TEMP experiment

This is proposed TEMP evidence, not a live-product change, release gate,
production authorization, superiority result or completion of the historical
five failures. The prior prebuffer proposal, old author8 and historical 3/7
profile remain untouched and are not acceptance for this cohort. Independent
688c4623 is historical only. No independent streaming bodies/private notes were read.

## Source and API

API S1 and CONTRACT.md were published before new source edits. Implemented Through
is Not applicable for the live product; the checker passes with zero warnings.
The baseline/API/contract commit is ddbb4d10. Source delta is c5e2d338; initial
control/results are 15fd7426; fixture-only curl binding correction is ba56e1aa.
Final commit identities are recorded in the external immutable final-result.

The source is authenticated v1 plus four explicitly attributed current retention
fix files, v2's explicit parent.child implementation, and an internal next-only
curl stdin adapter. It has v1's early output enrollment and streaming body path:
no v2 prebuffer, deferred stdin-dependent enrollment, usesStdin addition, lease,
stage autowrap or input API. Required file/header work keeps an independent
transfer lifetime; stdout body/header/writeout publication remains separately
scoped. ShellInput and top-level owner cleanup are unchanged. The mixed-sink and
cooperative invocation machinery otherwise comes from authenticated v1/07ac.

Exact tested final source manifest (213 files):
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`.
Final 15-fixture manifest:
`dd1814102e91c030d9cb1723bbaf69c3bf467ecd404e89dcb07cc315e5f5e35c`.
Final 708-compiled-file manifest:
`2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`.
tested-manifest.json contains every file, all 358 actual compiler inputs, config,
existing development tooling, restoration prerequisites and raw-run identities.
The source was authenticated again after runs, and independently reconstructed
by the author's restore tool with exact source/test/compiled/compiler identities.
That mechanical reproduction is not independent review.

## Exact original five: 1/5, not closure

| Original scenario | Result on this source | Distinct observations |
| --- | --- | --- |
| first-read-local | FAIL, original 1200ms deadline | Non-opt-in custom source stays active; head returns 0. Child exits 1 normally and is reaped. |
| first-read-s3 | PASS | Cat 141, downstream/public continuation 0; source finally observed. Probe's observed signal is reassigned inside provider read. |
| first-read-webdav | FAIL, original line 103 | Cat 141 and continuation 0; original whole-stage-aborted assertion sees false. |
| first-read-curl-body | FAIL, original line 103 | Curl 141 and continuation 0; original whole-stage-aborted assertion sees false. |
| first-read-curl-headers | FAIL, original line 103 | Curl 141 and continuation 0; original whole-stage-aborted assertion sees false. |

Original inputs, assertions, 1200ms operation deadline, 3000ms child deadline and
started-before-head barrier are byte-identical. Raw results are retained, including
the local timeout and the three assertion failures; they are not relabeled passes.
Original failure snapshots can precede remote peer close, and are not evidence
that operation-close equals whole-stage abort. Every child reports residual=false;
all supervised groups are reaped without supervisor timeout/kill. The separate
head-zero control passes (reads 0, top-level owner returns 1).

## API opt-in and historical controls

Authenticated v1 opt-in5: **5/5**. Each reports operation aborted, stage not aborted,
zero owned writes, and source/remote close before fixture teardown. This is a
different API binding and expectation from original5, not its replacement.
binding-path-delta.json records exact old/new TMP paths and unchanged input hashes;
the semantic adaptation remains the old v1 adapted-fixture.patch-data.

Unchanged57: **57/57** = remote19 + byte-IO28 + shared5 + streaming4 + head-zero1.
Unchanged9: **9/9**; C9 is synthetic, not product evidence. Optional historical v1
author12 replay: **12/12**, kept separate from the new six. Native5 artifacts and
hashes are preserved, not rerun; their GNU Bash 5.3/Darwin arm64 profile is not
GNU/Linux evidence. Optional old16 and historical v2 author8/new7 were not rerun.

## Contract-to-evidence matrix

| Contract/control | Final author evidence |
| --- | --- |
| S1 streaming, backpressure, producer ownership | Both bounded-stream and retry profiles send before EOF; blocked first write leaves one produced fragment. 17010 exact reused-Buffer bytes; replay identical after producer-finalizer mutation. 256-byte replay capacity does not prebuffer the 17010-byte upload. |
| S2 stdout-owned HTTP cancellation | Actual loopback receives 32768 bytes before EOF. Public pipefail status 141; transfer signal aborted; cooperative local transport cleanup completed once; stage stays live. Top-level owner return count 1 is normal, not a bug. |
| S3 independent borrowed owner | Actual context.invoke custom and curl bindings, late fulfillment/rejection subruns: child 141, operation/cooperative cleanup closed, stage live, owner live with zero borrowed returns, sibling file/stderr preserved. Top-level cleanup later returns once. No handback assertion. |
| S4 required mixed work | Body-file, header-file, healthy-writeout subruns preserve required files/headers, 11-byte upload, independent sibling file and stderr. Closed stdout profiles return 141; healthy profile returns 0 and writes 200. |
| S5 explicit child ordering | Normal close shares completion without abort; late child/acquisition refused; sibling works after child close; parent awaits blocked cooperative child cleanup. Aborted descendants preserve first reason. Opaque late resource releases after parent close, not universally awaited. |
| S6 precedence | Caller identity wins public rejection after EPIPE and cleanup failure; operation keeps EPIPE; single cleanup identity and multi-error order preserved; pre-aborted caller wins enrollment; genuine status 7 yields default 0 / pipefail 7. |

Six logical controls were frozen before execution. Initial r0: 6/6. Fixture r1:
6/6. S3 initially covered a custom binding only; a disclosed coverage correction
adds curl subruns within its already frozen intention. There are **zero source
self-fix rounds**, one fixture coverage correction, and no changed API. Both
raw rounds/fixtures and the exact fixture diff remain archived. None is independent
acceptance. All observations are bounded fixture evidence, not universal claims.

## Validation and limitations

Scoped copied source builds and source/test typings pass in both rounds. Compiled
public import and declaration-only consumer checks pass. Fresh restoration matches
all 358 compiler inputs and all source/test/compiled hashes. No rootdist, current
global typing, full suite, root configuration/exclusion, installation or live API
was changed. Captured code is inert .data/.patch-data; executable copies stay in
task-owned TMP. Existing untracked work/index/native artifacts were preserved.

Opaque reads/acquisitions remain uncooperative unless their owner provides a
cooperative hook. Cancellation may discard consumed bytes; no transaction,
rollback, universal drainage, cursor conservation or arbitrary host-preemption
claim is made. This next-only adapter does not promise framing/handback from old
D01; D02/D03/D07 are not bugs merely because top-level owner cleanup returns input.
File-required transfers may still do necessary network work after stdout closes;
that is intended isolation, not a universal completion guarantee. Non-opt-in
plugins stay unchanged. Replay caching remains bounded; body/query/format semantics
are not redefined. Current unrelated env/tree/export changes were not rebased.

An exploratory summary parser initially failed to unescape TAP diagnostic
backslashes; parsing was corrected without changing raw TAP or fixtures. This is
tooling interpretation, not a product fix. Reproduction uses authenticated existing
tooling and explicit PATH for apply_patch; no tool install is needed.
Evidence timestamps describe the actual bounded work interval, not 72 hours.

See RECONSTRUCTION.md and SEAL.json for immutable review paths. Root must observe
actual author CLOSED before independent execution; a ready marker alone is not
the worker's lifecycle close event.
