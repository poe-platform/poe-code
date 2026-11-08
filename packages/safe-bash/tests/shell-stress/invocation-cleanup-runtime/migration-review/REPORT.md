# Independent bounded cleanup test-migration acceptance

**Scoped acceptance: PASS. No remaining blocker in this bounded migration.**
This different verifier accepts the existing ten current canonical scenarios and
their source/build binding for the exact candidate below. This is **not** a
whole-gate acceptance, another candidate's qualification, broad shell parity,
performance, superiority, or 72-hour-work claim. No product, author harness,
canonical test, historical artifact, root configuration or dependency was edited.

## Exact candidate and pre-execution freezes

- Candidate: `4bb4ad85d4554889cd6f59097af776f4172e34d1`.
- Candidate tree: `138d4d7fc33d2b716b1c5758f82692dece4bb082`.
- Product source tree: `f214264ae13d47e1369513a12ccd2d6cf944a6ef`.
- Original independent freeze: `04ed66216afd0245238b8d125c5e8651d279a78b`.
- Review-only preparation correction / second execution freeze:
  `36e55ef94bc11deb785c90700e6b20cabc6786d0`.
- Author: `026e20cf38ddbb695d82de3f30cf7a1a7c88f088`; author evidence:
  `9167913d6410c7ac2b31ea61acb20c5dd4a07be7`. Those are separate cohorts.

Before execution, `freeze.mjs` authenticated 220 inputs from explicit Git blobs,
checked their working-tree bytes, captured tools and the actual Node executable,
and compared old/new assertions. `initial.json` records initial status/index,
later concurrent changes, source tree and timestamps. HEAD had already moved by
freeze completion; it was never substituted for the selected candidate. Product
source, canonical, probe and binding helper match author026e20cf exactly. Later
package/type-configuration changes are included in this new candidate's hashes.
At final execution capture, none of those 220 live inputs had changed.

Expected-envelope SHA256 (compact JSON):
`0c2f02a80388c6634df0963dfdcbb523842a44a3241e1df14d412ed78dcf56c7`.
Input-census SHA256:
`22f082922c6278a5b32e8046ca4652715383b39f6e4d127eb19b309e13a8877d`.

## Executed cohorts, kept separate

| Cohort | Observed result | Meaning |
| --- | --- | --- |
| First independent preparation | 0/10; ten failed before-hooks | Preserved review-copy defect, no semantic bodies accepted |
| Fresh exact-candidate canonical | **10/10**, zero fail/cancel/skip/TODO | Actual original ten scenarios, not substitute examples |
| Five malformed/tampered expectations | **50/50 setup rows rejected** | Null, false, wrong input hash, omitted input, wrong revision; no source manifest emitted |
| Four real-build binding tampers | **4/4 rejected** | Source, emitted module, copied probe, valid-JSON manifest |
| Two actual-loader tampers | **2/2 rejected** | Unchanged benign grep probe rejects altered module or emitted-hash manifest |
| Mutant against original source binding | **Rejected** | Exactly one source expression differs |
| Fresh retirement-mutant canonical | **0/10; ten genuine boundary failures** | All original scenarios reject premature native retirement |

The independent control ledger contains 14 assertions: five expectation controls,
four binding controls, two loader controls, one original-binding mutant refusal,
and the two mandatory normal grep/rg mutant rejections. These are not 14 extra
semantic scenarios. The complete mutant ten remain separately recorded.

Node `v22.22.2`, Darwin arm64, TypeScript `5.9.3`, existing dependencies only.
Second-attempt canonical execution ran on August 27, 2026, 12:59:37–12:59:43 UTC;
its mutant ran 12:59:47–12:59:53 UTC. No downloads, native regex/oracle probes,
servers, external targets or full gate were run. Strict unhandled-rejection mode
applied to the runner and descendants. Original canonical watchdogs were unchanged;
outer subprocesses had a generous 180-second ceiling. No watchdog fired.

## Semantic assertion preservation

`semantic-comparison.json` preserves both sets of eight original outer assertion
lines and verifies equality, excluding only the newly added binding-existence
assertion. Both loops still enumerate grep/rg × normal, early-pipe, caller-abort,
same-shell-sibling, other-shell-sibling. The entire executing public probe is
byte-identical to fixture85e6d560:
`2ca53ee66a4dcc1f85453fa9fd276e76da1d773ef6a51ea866eafeb2ddda3fe4`.

- Normal and early pipe retain exit0, exact buffered stdout/string/byte and sink
  byte checks, empty stderr, and retirement at exec/dispose settlement.
- Caller abort retains the same EPIPE-shaped reason object and reference-identity
  assertion, empty output sinks, and awaited retirement before rejection/dispose.
- Same/other-shell siblings retain selected-invocation reason identity, sibling
  signal/settlement isolation, resumed `bb\nbb\n` output/status and retirement.
- All native exit, terminate-call, termination-promise, zero-live-worker and
  zero-unhandled-rejection assertions remain intact. No expected output changes.

Independent event checks additionally confirm native exit AND termination
resolution precede every recorded successful public boundary. The sibling input
producer remains held across the selected invocation's rejection, and for the
other-shell case across its disposal; release occurs later, followed by an actual
new native request and sibling completion. The accepted ten observe **14 actual
workers and 30 public boundaries**, with zero live workers and zero unhandled
rejections at successful settlement. Those observations are not extra test passes.

## Actual executing build identity

Both independent builds compile fresh isolated copies; no existing dist or source
loader substitutes for product execution. The canonical fixture and unchanged
probe authenticate copied inputs, manifest bytes, public package entry, each
observed loaded module and the actual worker entry. They verify source/emitted
stability before/after every probe and in the final hook. The independent second
build matches all **708 emitted files** from the first build; its own before/after
censuses are equal after exact restoration of tampered bytes. All ten children
report the same **174 observed main-thread product-module identities**. Worker
entry identity is recorded separately; this is not a claim of a separate hook
trace inside worker threads. The full emitted tree is integrity-checked.

| Actual loaded artifact | SHA256 |
| --- | --- |
| `dist/index.js` | `77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d` |
| `dist/shell/shell.js` | `38dced6b802a8aebf277a197061e83f3dcb9a9d1fed3372ce13a655f0e8ddd3d` |
| `dist/shell/runtime.js` | `ee3e045a1770cc43591a19936ec153e9a29c959c9de5886d2112427a9d20e97a` |
| `dist/commands/regex-execution/client.js` | `92416db354410d84172a13d53a2fd757d61d9979745a38bd0c297a06309e17f5` |
| `dist/commands/regex-execution/worker.js` | `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7` |

Full hashes, actual paths and per-child provenance are in
`evidence-attempt-02/canonical-manifest.json`, `canonical-reports.json`,
`independent-build-manifest.json`, `emitted-before.json` and `emitted-after.json`.
The canonical manifest's compact-JSON SHA256 is
`be08a7ac693e275394df011e811df0399f3140e74049125431436586c4d34cd0`.
Tampered module/manifest children fail specifically at
`Emitted identity: dist/shell/shell.js`, before any worker creation; not at a
syntax error, empty discovery, timeout, or unrelated behavioral assertion.

## Retirement regression sensitivity

Only the owned isolated source copy changes:
`if (!this.exited) await this.worker.terminate();` →
`if (!this.exited) void this.worker.terminate();`.
The original expectation rejects this source delta. A newly built, truthfully
labeled working-copy mutant then executes the actual unchanged canonical ten.
All ten children have `sourcePinned:true` and natural exit1, with original
`exec-settled`, `exec-rejected`, or `exec-rejected-owned` failures stating that
worker1 has not exited. Both required normal grep and rg fail the original
`exec-settled` assertion. This is genuine runtime rejection, not a stale hash.
All mutant reports have zero recorded unhandled rejections. Their one live worker
at the premature failure boundary is the intended regression observation, not a
successful cleanup assertion; the child processes subsequently terminate naturally.
The patch, source hashes, manifest and every failed child report are retained.

## Preserved failed preparation and history

The first independent preparer used `cpSync` with `dereference:true`, but its
copied `.bin` links still resolved into the original checkout. The author's
unchanged containment check correctly rejected them. `SETUP-CORRECTION.md` and
`evidence/tool-copy-forensics.json` document the reproduced preparation defect.
First raw logs/ten failed hooks remain under `evidence/` and `run.stderr.log`.
Only the review-owned file materializer changed; the correction was committed
before attempt02, with no changed candidate or assertion expectations.

Historical runtime `4c16d9c5a0e8661bc326a754205559a3e7ea6a32`, fixture/probe
`85e6d56017bafebf9aa8849cd9e038229e49c863`, all six original pins and all ten
original b494 failed rows are authenticated against Git and the original
compressed full-gate capture. Those failures remain explicit old-source
before-hook failures, not current product bugs. Historical data remain outside
default discovery, and their explicit historical replay entrypoint remains
untouched. This verifier did not rerun historical acceptance. All existing author
migration/evidence bytes match the frozen before/after census. Author historical
passes and author026 results are not substituted for this candidate's result.

## Cleanup and qualified whole-gate handoff

All nine second-attempt direct subprocesses and twenty nested canonical probe
children exited naturally, with no signal/timeout error. Both candidate builds
and the mutant build completed successfully. Original failed-attempt cleanup is
retained separately. No process-group operation or broad kill was used. Only owned
scratch trees were removed, including an incidental Node compile cache left in
the owned nested temp directory. Final PID checks and artifact authentication are
recorded by `verify-evidence.mjs` in `VERIFICATION.json`. Owned status is checked
after the explicit-path evidence commit and reported in the ready marker; unrelated
working changes, staging and native artifacts are not touched.

For a qualified whole-gate caller, the authoritative envelope for THIS candidate
is `expected-inputs.json` with both `VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED` and
`VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT` supplied. The latter must be the exact full
candidate above. Changed source/configuration/envelope bytes require a fresh
qualification; current HEAD alone is not proof. Root can use this scoped migration
acceptance in its own gate accounting. No whole-gate run or acceptance is inferred.
