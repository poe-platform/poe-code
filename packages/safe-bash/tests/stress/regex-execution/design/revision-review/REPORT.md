# Independent regex revision verification

Status: baseline **14/16** independently reproduced; fixed original cohort
**16/16**, additional benign guards **12/12**; adapter/policy/package evidence
independently inspected and recounted. No new blocker in the two authorized fixes.
This is a bounded test-only review, not an engine audit,
production integration, public API approval, superiority claim, or 72-hour claim.

## Immutable baseline

Frozen at 2026-08-27T05:12:38.056Z, before author changes, with readiness marker
`/tmp/regex-revision-baseline-ready.txt`. Snapshot location:
`revision-review/.temporary/baseline` (relative to the parent design directory).
`evidence/baseline-freeze.json` records every source hash and the absolute path.

- Prototype: `4484026b9e0f87359733ac5f2dcbd49798473aa6`.
- Original source bundle/evidence: `aba917c69ba949ffaa5f844b4181c713415fe891`.
- Independent original child, fixtures, runner and expectations:
  `ad4c5adda0ea430438a1d3235520760270ad882e`.
- Historical independent outcomes: `3b27782db975ca95eac4bf3f881e1725a63bbcf7`.
- Original client SHA-256:
  `6a19d72697a73ec03be929e4494a00afb87edaecdd3a43d5dfc5e624e7d202f2`.
- Runtime: Node v22.22.2, V8 12.4.254.21-node.39, Darwin arm64.

All 197 original source/toolchain identities plus three copied compiler support
files are frozen. Historical source-bundle bytes, including the original dirty
source identities, are preserved rather than replaced with moving HEAD. All
seventeen newly emitted JS assets exactly match original frozen output hashes.
The original child, fixtures and runner are byte-for-byte unchanged.

## Baseline result: 14/16, two retained failures

`evidence/baseline-summary.json` and `evidence/baseline/` retain every result,
observation, exact child exit, assertion stack and cleanup state.

- `idle-exit`: actual external Worker termination leaves `created=1`,
  `terminated=0`, `releaseHeld=true`, capacity active 1 and one abort listener
  before explicit cleanup. Original assertion fails `1 !== 0`.
- `live-source`: first row remains buffered while the second `next()` is pending.
  At the unchanged 40 ms observation, no Worker exists and no output is available.
  Original assertion fails with `observation-timeout`; explicit source EOF
  subsequently produces the expected row.
- Fourteen other original checks pass without changing assertions. All sixteen
  exact children exit and close IPC/stdout/stderr normally; zero watchdog kills.
  Explicit final Worker cleanup succeeds even for the two failing checks.

Copied original runner metadata contains historical risk-accounting labels.
Those are immutable archival labels, not revision consumption. Only its benign
mode ran. This revision's authoritative ledger is below.

## Fixed-source review: 16/16 plus 12/12

Author-ready source/report/build hashes were checked before preparation. Fixed
prototype commit: `398143a253ada226340c05a8028add4df78d00ae`. Author evidence:
`80f69f978657adc447ff77adb519770f3c8b078d`. Independent freeze:
`evidence/fixed-freeze.json`, committed at `79021e7` before cohort execution.
Only `client.ts` changes relative to the original isolated source snapshot:
`f2c5512b2785f146e68f3a335afd646ab74a3fdfa2370743151a05a7827044d5`.
The independently compiled client matches the author's emitted SHA-256
`abb22e92de0cc3f2a2fea18fed63b6d5b6f7e6694cdea0f72e709129e76b4e01`.
Other original dependency inputs and all original assertion bytes are unchanged.

All sixteen original checks pass, including the unchanged 40 ms live-source
observation and automatic idle cleanup before manual disposal. No expectations
were relaxed, no fixed cases were retried and no risky cases were run.
`evidence/fixed-summary.json` retains complete outcomes.

Twelve separately frozen benign guards pass (`evidence/guards/summary.json`):
active exit, active error, exit/error/abort race, live partial close, pending
read rejection, cooperative pending-read abort, uncooperative pending-read
abort, consumer close queued behind pending read, downstream throw, source
next ordering, per-batch byte limits, and actual capacity semantics.
They inspect pending promises, owned Worker/signal/output listeners, exact
termination counts, capacity release and single-next/return ownership.

The initial ten-guard draft is preserved at `488cc23`. Before any guard execution,
its cancellation fixture was corrected to explicitly cooperate with the signal,
and two separate uncooperative/queued-return guards were added at `f042b79`.
`GUARD_EXPECTATIONS.md` discloses this fixture correction; it is not a discarded
failure or a change to the original sixteen expectations.

Observed limits, not hidden successes:

- Arbitrary pending `next()` cannot be interrupted. Abort cleans the Worker
  while the owned read remains pending; late rejection is observed, and return
  waits for that read. Prompt source cancellation requires source cooperation.
- Each available row now flushes alone, with one reused Worker. `batchSize`
  remains an upper bound, not a fill target. Explicit `batch(Row[])` is unchanged.
  Stream calls therefore spend unchanged request/work budgets faster.
- An explicitly shared prototype Capacity still rejects `CAPACITY_BUSY` rather
  than queueing and retains its slot while idle. Independently supplied Capacity
  instances are independent; concurrent calls on one Client still reject BUSY.
  Automatic idle exit frees the held slot. This is not approval of a global
  one-slot rejection/idle-pinning production policy.

## Adapter, policy and package review

Reviewed exact validation evidence commit
`60df83b62c3ca12623b40db7f3af105e9cce3dee`, not moving HEAD. All 80 committed
validation artifacts and the six handoff source hashes match.
`evidence/validation-review.json` independently recounts **53 recorded children**:
52 passing observations and original failing `run-17.json`, which remains failed.
The targeted Kelvin recheck retains its exact expectation and fixes only the
test adapter's equivalent `giu`/`gui` spelling. Initial compiler and empty-rg
oracle defects, unrelated README interruption and continuation are disclosed.
No validation execution was rerun by this verifier.

- Effective command equality is 22/22 for stdout/stderr bytes and status; raw
  capture vectors 6/6. These are adapter/current equality, not native parity.
  Native status/stdout agrees on 19/22. The other three preserve declared JS
  alternation/digit differences and expose the named-backreference loophole.
  Local advertising rejects backreferences while the matcher misses named
  spelling; keep this as a root dialect decision, not mandatory JS compatibility.
  Native evidence is default-engine rg 15.2.0 plus auxiliary Darwin BSD grep;
  GNU grep is unavailable and has zero measured cases.
- Five policy observations include one explicitly negative idle-slot rejection.
  Actual live/concurrent Shell pipelines show request leases released at tested
  source/sink waits, 18 requests across three concurrent pipelines and two reused
  Workers. This does not establish queue saturation/cancel-removal fairness.
- Eighteen microbenchmark records have identical logical capture/result and
  selected-byte hashes per workload. Extra framing/IPC, unequal JIT warmness,
  separate startup, overlapping stream retirement, three repetitions, host load,
  mid-cohort interruption and non-peak RSS limit performance conclusions.
- The moved offline package contains static JS/declaration siblings, zero runtime
  dependencies and an actual bare-ESM Node 22.22.2 consumer with awaited Worker
  cleanup. All four packed JS hashes match this verifier's independent build.
  This is a prototype package proof, not published virtual-bash integration.

Residual integration blockers are explicit: copied adapters retain host RegExp
construction, omit caller signal in `workerHits`, and share cumulative Client
budgets by descriptor session. Eight-waiter/four-session test caps can reject;
they are not an approved global policy. Current prototype limits are narrower
than existing command promises. Proposed opt-in no-signal timeouts, scheduling,
overload and shared budgets require root approval; **no product default/API is
changed or approved**. No author, adapter, product or historical files were edited.

## Risk ledger and cleanup

The historical twelve pathological probes remain archived and were not rerun.
The separately authorized-six revision tranche reserves author two, verifier at
most two, and root two unused. This verifier consumes **0/2** and does not need
new pathological execution to establish the baseline failures. No claimed or
failed risky case is retried. No external target or process-group kill is used.
Only exact owned snapshot paths and child/Worker handles are used. Across the
three cohorts, **44 exact children** and **54 created Workers** close cleanly:
baseline 16/20, fixed 16/20, guards 12/14. Zero watchdog kills, active owned
children or unclosed owned Workers remain. `evidence/audit.json` rechecks all
205 baseline identities, 227 fixed runtime/source/build/harness identities and
255 immutable original author/review artifacts. Snapshots are retained ignored
for reproducibility; original artifacts remain untouched.

## Commits and checks

- `249fe5e`: baseline freeze, exact identities and original expectations.
- `3d06ccf`: independently reproduced baseline evidence, 14/16.
- `488cc23`: ten additional benign guards frozen before execution.
- `f042b79`: disclosed source-cooperation fixture clarification; twelve guards.
- `e428898`: pinned fixed build and unchanged-cohort harness.
- `79021e7`: exact fixed source/emitted identities before execution.
- `323ad4a`: fixed 16/16, guards 12/12, identity and cleanup audit.
- `ac64252`: independent adapter/policy/package evidence inspection and recount.
- `8bb3697`: initial final report; final readback correction follows separately.
- Scoped compiler build and original benign cohort run; new guard JS syntax
  checked. Evidence-only validation review passes. Scoped whitespace checks pass.
  Final tracked scope is clean after committing this report; ignored snapshots
  are intentionally retained. Exact final commit/status is also handed off in
  `/tmp/regex-revision-review-final.txt`. Unrelated worktree/index edits are preserved.

Final readback disclosure: the first evidence-reader attempt failed ENOENT because
`audit.mjs` labels digest keys `vidence/...` (one leading character omitted).
Original digests, audit, script and all test evidence remain unchanged.
`final-verify.mjs` and `evidence/final-verification.json` preserve that failure,
correct labels in a separate manifest and verify every original digest plus
fixed identities, immutable originals, validation artifacts and handoff sources.
This metadata correction reruns no cohort, native command, Worker or regex.
