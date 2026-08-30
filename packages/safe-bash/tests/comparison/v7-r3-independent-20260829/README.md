# V7-r3 independent review: SOURCE findings, synthetic HOLD

Date: August29,2026. This is NOT preexecution acceptance, engine admission, a
comparator/product evaluation or a semantic result. No author/product files were
changed. No actual module was imported; source text was read as authenticated data.

## Frozen inputs and exact inspected scope

Repair source: `f7b9f0d4dd2fc6edd721597ec9d3e7db05267c98`.
ROOT also supplied preparation `fe803701`, seal commit `d306b837` and author
evidence `9b6c8a04d0e3227ead7d055253b80fec7479f04b`. The later preparation/seal/
evidence chain was NOT independently authenticated or replayed in this stopped
review; its author25-process/333-load/13-package counts receive no independent
credit. Findings below name the exact f7 source revision, not unexamined successors.

One bounded developer Git command captured the complete NUL-delimited inventory
for tests/comparison/breadth-continuation-20260828 at f7:459 entries,63,238 bytes,
SHA256 `5f94ef6530fe45478d5e0fc002a9a0a5575a1b77c272f84422b3626c60e4f0d2`.
Metadata/TAB/path/NUL boundaries were parsed byte-exactly, with duplicate/domain
checks and fatal UTF8 roundtrip, no trimming or C-quote reinterpretation.
45 bounded regular text files matched their captured Git blob IDs and0644 modes.
SOURCE-BINDINGS.json records44; SOURCE-FINDINGS.json additionally binds SEAL.json.
This is not a whole historical closure or prepared-fixture authentication claim.

Important bound files:

- r3 worker.mjs:11,608 bytes, SHA256
  `6621ba59c5b3d5a1da519a29e3a095cca1dd189da6915e1290a6ff5ca35c984f`.
- inherited r1 bootstrap.mjs:5,261 bytes, SHA256
  `5104b893860638beb026acac1526f677eb2861a6a2c354e58818cdf51bc04ffd`.
- inherited v6 loader.mjs:5,431 bytes, SHA256
  `0878dfd6ec02b7c232495e44e4e702216586ce0b5e7eb42aad73abb817683a97`.
- r3 test.mjs:11,992 bytes, SHA256
  `500bf5da43511d6607056427202e11a57da7902f73d3bc01b68aa9fff6dbfb9d`.
- r3 SEAL.json as stored at f7:105,131 bytes, SHA256
  `bd4690d595751b99b3a2bf020f0063f86c03b23ae2600ecaa637be7dc6096b1c`.
- r3 INTERFACE.json as stored at f7:10,977 bytes, SHA256
  `f6c3965ad7b31747dad30b3357de8813a28b3c18963a39ad04582358e3f55c18`.

The short seal-commit identifier d306b837 is NOT treated as a SHA256 prefix or
compared to the f7 SEAL file hash. Those are different kinds of identities.

## Source assessment of the repair

The requested ordering change is present in worker.mjs: authorization/operation
binding and view checks precede bootstrap authentication at54; loader installation
is58; offline guard installation60; the consumer import starts65/67. There is no
await between authentication and guard installation. No consumer factory is
called before both guards. The r2 worker in the same captured tree instead installs
both guards before authenticateBootstrap, consistent with the supplied old failure.

The inherited loader still authenticates file metadata/hash and actual returned
source, validates exact worker-to-consumer and consumer-to-bare-library edges,
denies unbound modules, and records refusals. This protects the authenticated
import path against the source-drift schedule; it is not an atomic-filesystem or
hostile-host-JavaScript race guarantee. Dynamic drift/refusal proof was not run.

The inherited bootstrap getter accepts only the two single primitive-string
arguments module then worker_threads, returns undefined without calling a native
getter, and revokes after slot2. Its closure makes captured aliases obey the same
revocation. importWithWindow revokes and restores the prior guard descriptor on
both success and failure before returning to factory code. Violations persist:
even if a consumer catches a denied call, qualify or the final close refuses it.
The worker's primaryPresent flag preserves selected falsy/undefined errors. These
are SOURCE observations, not newly executed getter or falsy-rejection controls.
The source explicitly reports callerAuthenticated=false and stockNodeCapabilities=
false; this absence profile does not certify raw Module/CJS access or stock Node.

The six declared r3 exact-copy files match their r2 counterparts in the captured
f7 tree: authorization, body, coordinator, production, synthetic-worker and launch.
No general policy relaxation was found in the focused ordering path. This is not
an exhaustive independent review of every inherited function or later prep body.

## Execution HOLD and two concrete replay barriers

H01 — my metadata wrapper, not the repair: the Git child52259 emitted63,238 raw
stdout bytes,0 stderr, and an exit/close0 event with no signal. The wrapper then
referenced `process.kill(pid,0)` in the Node REPL, where `process` is undefined.
Its catch reduced that ReferenceError to absent=false without preserving the
exception. No PID probe actually ran; false is NOT evidence that the PID existed
or that a child leaked. The unavailable binding was confirmed by a data-only
typeof check. The raw files are child Git capture; HOLD.json is the subsequent
structured diagnosis, not a raw wrapper exception transcript. No second census,
signal, retry or synthetic admission was performed. PID absence remains unproved;
the original exit/close observation is retained without promotion.

H02 — unchanged authored replay cannot honestly meet peak2 including its runner:
test.mjs98 starts a supervised worker; supervisor.mjs31 spawns it; while that
worker is alive, authorization.mjs77 uses spawnSync for each metadata stub. The
runner + worker + metadata child therefore coexist (at least3). Concurrency1 does
not remove this nesting. A separately presealed peak2-compatible direct-worker/
capture arrangement is needed; neither hide the runner/grandchild nor widen quota.
This is a SOURCE call-graph barrier, not a measured violation in this review.

S01 — exact f7 preparation/test entrypoints have an evidence-budget omission:
r3 records forwards to r2 records, whose createStore(root,options) throws
SHARED_EVIDENCE_BUDGET_REQUIRED at line71 when options.budget is absent. Yet
r3 test.mjs21 calls createStore(evidence), and prepare-controls.mjs16 calls
createStore(output), without that option. The latter occurs after fixture
construction but before prepared-fixture receipt publication. This is a bounded
SOURCE counterexample, NOT a runtime failure observation or an accusation about
the uninspected later preparation. Authenticate fe803701/d306b837/9b6 before deciding
whether this was already repaired; do not retry the f7 entrypoint speculatively.

## Capture/lifecycle qualifications

Inspected supervisor defaults: stdout65,536 bytes, stderr65,536, FD3 total262,144;
deadline30s, TERM grace2s, KILL grace1s. It counts observed bytes, retains only the
bounded prefix on overflow, records CAPTURE_LIMIT and stops. Therefore it promises
refusal of a truncated run, NOT preservation of every over-limit byte. The terminal
assessor requires exact observed/retained lengths, natural exit, matching exit/close,
reaped state and empty failure/signal arrays before acceptance. These guards were
read, not dynamically validated. Old V6 lost294,045 bytes are not reconstructed.

Record cap262,144; logical document cap33,554,432; default store ceiling268,435,456.
Production body requests260,046,848 bytes (248MiB) and audits shared evidence;
the overall248+8MiB accounting remains STATIC_ONLY here. The author eight-case plan
declares64MiB evidence; the missing-budget entrypoints must be resolved rather than
claiming that declared cap was exercised. No RSS or hard-preemption guarantee.

## Required controls — all UNRUN

S01 positive; S02 old-worker reversion; S03 post-authentication source drift;
S04 wrong wrapper bytes; S05 wrong wrapper mode; S06 invalid grant role;
S07 caught refusal at first index evaluation; S08 caught late factory filesystem
refusal. Independent count:0 executed/8 required, not0 passed tests or8 failures.
Additional authentication-failure, caught-getter/alias-revocation,
consumer-before-guard, output-truncation and child-cleanup adversarial controls
were not presealed or executed. No executable independent preseal was completed.

Only one review metadata child ran. Its observed exit/close0 and unavailable
absence probe are distinct. Developer edit/Git archival tooling is separate, not
synthetic controls. All text/capture remains small, within the supplied resource
envelope; no permission increase, real engine, native oracle, private source,
network, XAN action, C11, actual staging/admission or semantic execution occurred.

## Readiness / next boundary

NOT ready for actual admission or a semantic cohort. First resolve the independent
metadata supervisor bug without masking its original record; authenticate the
later prepared packet; reconcile the mandatory budget and total-process call
graph; then seal exact harmless fixture/control inputs and a peak2 owner recipe.
Only a separately authorized continuation may supply the missing dynamic evidence.
Any future actual admission needs its own fresh phase-bound root grant; no old
consumed token is reusable and no actual launch command is approved by this note.

Preserve the supplied V7-r2 25cbb03f1fa1ced0238749235d37eafb001e009e consumed3/14,
zero semantics/12 retired processes/no new capture loss; V6 loss294,045 bytes;
old scores and W07 UNQUALIFIED. Frozen target78/67eab12e/full858 and pinned
just-bash3.4.2 were not upgraded or evaluated. The supplied August29 npm metadata
audit9fa970790c3230cd9d52e55112a8332cdd9443d2 is not empirical comparator evidence.
No winner, completed independent acceptance, or actual-admission claim.
