# Shared-memory delivery disposition — 2026-09-14

Overall task: **OPEN**. These delivered repairs are independently verified
increments, not evidence that arbitrary concurrent histories can be recovered.
The target remains ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025), plus
the evidence ledger's explicitly tracked newer APIs. Test262 remains pinned at
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

## Delivered source and local gates

| Commit                                     | Repair                                                                          | Fresh local checks                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `069ae0b0913040c33feb0d8c07f0531d6d6c0dc8` | Reject capture after callback shared-storage export                             | Ten regressions; full package 29,651 pass / 47 explicit skips; maintained build and scoped lint               |
| `85c0bb75933965e77c02a91f3c26af53acedf638` | Bind atomic wait activation to its resource owner; reject registration mutation | Three red, then 19 green; scoped lint and package typecheck                                                   |
| `d63d1f4bb81b4514d873090b970b796bb15be702` | Finish partial-activation cleanup before rejection                              | Two red; 21 focused green; 2,336 snapshot/disposal/callback tests pass, zero skips; scoped lint and typecheck |

All three commits were pushed normally as `HEAD:main` from a detached worktree,
without force or hook bypass. Fetch and `git merge-base --is-ancestor HEAD
origin/main` verified delivery after each push. The original branch, staged
content and unrelated work remain separate and preserved. No issue number was
explicitly associated, so no issue was closed.

The final code's maintained selected workspace build passed: 23 builds derived
from workspace declarations and eight built-import checks. This does not relabel
the parent package run as a new final-source full package run.

## Deterministic histories and limits

| History                                                       | Current evidence and disposition                                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confined guest shared storage, scripted waitAsync/notify      | Original and completed public replay return `[1,"ok"]`; independently gated worker tests establish host event-loop progress.                                                                                                 |
| Low-level pending wait restore into isolated restored storage | No registration until explicit activation; owned activation preserves FIFO independently of heap order, remaining wait time and cancellation. Integer/BigInt tests cover malformed metadata and cleanup.                     |
| Partial activation followed by registration failure           | Rejection waits for termination. Real-worker QA observes restored notify counts `[0,0]`, original counts `[1,1]`, and a live caller owner.                                                                                   |
| Shared storage returned/thrown/rejected from guest callback   | New capture rejects explicitly; completed original succeeds but marks replayError, pending dump rejects, public restore rejects before repeating receiver effects. This is a recovery restriction, not an ECMAScript defect. |
| Raw shared arguments and retained cross-call aliases          | Boundary snapshots do not record every intervening observation. Current queued-write witness returns original 7 and replay 0; pending recovery can issue effect arguments `[7,0]`. **Unresolved** early-rejection defect.    |
| Legacy unmarked callback snapshots                            | The new producer marker cannot prove old callback-result histories. Comprehensive pre-resumption rejection or an enforced ownership protocol remains **unresolved**.                                                         |
| Concurrent change-and-undo                                    | Equal boundary bytes can represent distinct histories and observations. No deterministic recovery guarantee is claimed; boundary equality is insufficient proof.                                                             |
| Upstream agent fixtures                                       | The delivered runner still excludes agent fixtures. Original-workspace agent work and historical 968/986 observations are not qualification of this delivered source. **Acceptance blocker**.                                |

Successful scripted host-boundary tests prove those schedules only. They do not
prove exclusive memory ownership, deterministic arbitrary host-retained buffers,
or recovery under unobserved concurrent mutation. Snapshot bytes cannot restore
external agents' hidden state. Host authority must remain explicit; do not fix
conformance by enabling blocking Atomics.wait on the host event-loop agent.

## Runtime cells

[Manual QA](manual-qa.md) and [rollback receipts](built-rollback.json) use actual
native workers and no wall-clock ordering assertions. All six exact Node runtimes
(18.18.0/ICU73.2, 18.20.8/ICU74.2, 20.20.2/ICU78.2, 22.23.2/ICU78.2,
24.21.0/ICU78.3, 26.8.2/ICU78.3) and stable Bun1.4.2/ICU78.1 pass.

[Operation receipts](built-operations.json) compare nine integer/BigInt atomic
operations across eight typed-array kinds against native execution and completed
replay. All seven runtime cells pass those comparisons and the nonblocking
controls. Growth plus fixed/tracking aliases and completed replay pass Node20,
22, 24, 26 and Bun1.4.2. Both Node18 cells fail growth explicitly with
`Growable SharedArrayBuffer requires host runtime support.` Each exits 1; neither
is counted as a skip or pass, and the advertised runtime floor is unchanged.
The earlier Bun1.3.11 canary native shared-clone nonpass remains retained.
Published-edition DoWait BigInt-index behavior, Workerd and full backend/runtime
conformance remain outstanding. These smoke checks are not full conformance.

## Release monitoring

Callback root run `34813254084` succeeded but explicitly declined publication
because its branch was behind remote main; root stayed 15.0.37 at that observation.
Its scoped run `34813253991` published and verified all three packages at 0.1.592.
Ownership scoped run `34815610157` published all three at 0.1.593; independent
[installed, integrity and provenance receipts](0.1.593.json) verify the exact
ownership source. The FS receipt collector initially used a plural key against a
singular smoke record; the collector error is retained and its corrected smoke
and signature audit pass. This was not a package failure or relaxed assertion.

Ownership root run `34815610390` was cancelled while still in validation (no
publish job running), after confirming queued successor `34816549695` at
`d63d1f4bb` contains `85c0bb759` by Git ancestry. The successor must finish and
publish before root release is credited. No local publication or rollback occurs.
Final code scoped run `34816549405` and schema run `34816549413` are independently
monitored. Actual versions and terminal receipts are recorded separately.

## Concrete remaining work

Enforce a recoverable ownership/history protocol, or reject every uncaptured
shared boundary before dump/resume and before any host effect. Cover raw arguments,
host-retained imported results, cross-call aliases and old unmarked journals;
retain successful original execution and existing public/low-level distinctions.
Use independent schedules for invocation, settlement, between-call writes and
change-and-undo. Adopt/review isolated agent transport separately from unrelated
module changes, then rerun the pinned upstream shared-memory selection at its
maintained deadline with every failure and unsupported fixture accounted for.
Resolve the runtime/edition discrepancies without narrowing support or target.
Until those conditions are evidenced, do not close this task or advertise
arbitrary shared-memory replay as solved.

## Receipt checkpoint before evidence delivery

Final scoped and schema workflows `34816549405` / `34816549413` succeeded.
SafeFS and Safe Bash **0.1.594** independently verify against source
`d63d1f4bb81b4514d873090b970b796bb15be702`, including installed smoke, signatures,
tarball integrity and SLSA subject/source. [Receipts](0.1.594.json).
SafeJS **0.1.594** was accepted by npm at 07:13:56Z but remains unavailable at
this checkpoint: exact version, full packument, canonical tarball and attestation
read-only observations are in [propagation receipts](594-propagation.json).
This is partial publication, not a successful complete release.

The [fresh final-source raw-argument witness](raw-argument-final.json) confirms
7 versus 0 and pending effects `[7,0]` on the final code; it is an explicit nonpass.
The existing public manual QA's second module reproduces it.

The evidence commit will become the next descendant on main. If the previous
root validation is still running, it may be cancelled only before publication
and after verifying the successor's ancestry. Follow that successor through
publication; a green predecessor or a missing package is insufficient.
For registry propagation, retry exact metadata, canonical tarball and attestation,
then install each affected package independently and audit signatures. Do not
republish, unpublish, roll back, or substitute a previous version. If processing
never completes, retain the accepted publisher workflow receipt and request npm
publisher-support investigation; the release remains unresolved.

Terminal receipts after this evidence checkpoint belong in
`final-delivery.json` alongside this file; that receipt must distinguish its
local observation from the enclosing committed checkpoint. It must record the
actual root version/source, all final workflow conclusions and verified ancestry,
not assume the next numeric version or that a successor contains the repair.

## Local terminal observations after the committed checkpoint

All three scoped packages **0.1.594** now verify independently against `d63d1f4bb`:
registry integrity, attested subject/source, installed public smoke and npm
signature audits pass. SafeJS required repeated metadata/artifact propagation
checks; every failed attempt remains in the updated receipt.

An additional attempt to run the source-built private rollback module against the
scoped installation fails during import on all seven runtimes: that distribution
bundles internals and does not ship `interp/budget.js` as an executable private
entry. [Failed probe and disposition](installed-rollback-594.json). This is not a
promised public capability or an ECMAScript defect. It is not counted as an
installed rollback pass; the public package checks and seven passing source-built
low-level checks remain separate. No export or assertion was changed to force it
through. Root workflow monitoring remains pending.

Root **poe-code15.0.38** is now published and independently verified against
`711f06c1c5e291c29d58c801f637d7d26960ea9d`. The exact
[workflow](https://github.com/poe-platform/poe-code/actions/runs/34817400344)
succeeded. [Registry and installed receipts](root-registry-installed.json) verify
tarball integrity, SLSA subject/source/workflow, seven Node/Bun public SafeJS smoke
cells, 208 registry signatures, 38 attestations, and installed CLI version15.0.38.
The fresh CI SafeJS gate reports **29,656 passed / 47 skipped**, 1,370 passing
files / two skipped. This is final runtime code coverage; the later conformance
admission change is separately qualified.

Non-agent admission was delivered as
`95989c1aebba4a415510a69777277183f1506918`. Its
[committed provenance](../non-agent-admission/committed-provenance.json) matches
the exact sourceHash of the candidate's complete upstream run. That run records
730 passes, 18 immutable-buffer helper failures and 238 explicit unsupported
agent/blocking variants. It does not close agent acceptance or raw/legacy
shared-history recovery. It changes maintained test integration, not published
runtime implementation. Its triggered scoped/schema/root workflows are still
followed independently; no successor publication is assumed.

All three scoped packages **0.1.595** now verify against the conformance commit
`95989c1aebba4a415510a69777277183f1506918`.
[Independent receipts](0.1.595.json) include exact publisher provenance and
installed public checks. SafeFS/Bash verified before SafeJS; SafeJS's failed
metadata attempts remain retained. Scoped workflow
[34820625705](https://github.com/poe-platform/poe-code/actions/runs/34820625705)
and schema workflow
[34820625885](https://github.com/poe-platform/poe-code/actions/runs/34820625885)
succeeded. Root admission workflow34820626022 remains in validation and may be
superseded only by a verified descendant carrying this same test integration.

`git diff --exit-code 711f06c1c HEAD -- src 'packages/*/src' package.json
package-lock.json` confirms no released runtime source/config changed after root
15.0.38. The installed root artifact also omits the conformance test runner.
The admission is a test-only integration commit; the enclosing receipt commit is
documentation only. A subsequent successful root workflow may therefore report
no relevant release changes. That would be recorded as a no-release outcome,
not claimed as a new publication. All actual affected publications above have
already been independently verified; overall task acceptance remains **OPEN**.
