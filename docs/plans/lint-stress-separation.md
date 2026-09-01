# Lint unit/stress separation

Current delivery note: the later explicit Git/native removal decision supersedes
the historical native-job preservation notes below. The e81daf1e5 reconciliation
retains its serial CI workspace execution and newly added OS-temporary-root
tests, followed by the same mandatory stress callbacks and seven-minute bound.
Older matrix counts remain component evidence, not this later graph’s results.

2026-08-31. Bounded qualification complete with **no new strict diagnostics**.
The original ten diagnostics remain; this is not strict-zero or hosted release
qualification. Earlier freezes and every RED remain preserved.

## Contract and scope

Published basis: `e537758e579b1dac2b3ed9c765d456cdef3b6d84`.
Approved proposal: `/tmp/safejs-lint-stress-split.bp2KI9/docs/plans/PROPOSAL.md`.
Implementation successor: `/tmp/safejs-lint-import-consolidation.NxICfq`.
Reviewed parent: `/tmp/safejs-lint-stress-implementation.2uR1ge/qualification-freeze`.

The two existing scale cases move to `scripts/lint-eslint.stress.ts`; shared
memfs helpers move to `scripts/lint-eslint.fixtures.ts`. The original unit
file retains the other 246 cases and adds one bounded inventory-failure/fresh
initialization control using the existing injected dependency. No counter is
fabricated and no production guard changes.

`vitest.lint-stress.config.ts` inherits the actual unit configuration but selects
only the stress file, with one worker and sequential cases. Root unit workers
remain two. The package manifest adds only `test:workspaces`, `test:stress:lint`
and `posttest`; existing `test` and `test:unit` stay unchanged. Workspace
concurrency remains caller-selected, including the existing four-worker route.

Ordinary `npm test` is intended to require stress through `posttest` after the
workspace/unit gate succeeds. A failed prerequisite leaves qualification
failed/incomplete, not stress-passed. The release workflow remains Feynman's
unmodified responsibility: run the workspace/unit phase then a required,
noncompeting stress step with the approved seven-minute outer deadline.
Real npm lifecycle/argument forwarding is now qualified in bounded disposable
controls. This is not a run of the complete production workspace graph.

The explicit new stress budget is 180,000ms per case. It is not a claim that
the old 30,000/20,000ms hosted deadlines passed or that the guard became faster.
Vitest deadlines are not preemptive watchdogs for synchronous JavaScript.
The hosted hard deadline requires the separate workflow integration.

## Preserved cases and work

1. `guarded configuration bootstrap ordering captures the actual metadata cap
   in inventory phase and clears a fresh initialization`: unchanged callback
   SHA-256 `a851820f8c73f3d5ae07f8695ac2d47ac043e41d8c03d28d24d73f3d1cf80679`.
   Retains the 8,000,001 loop bound, 8,000,000 actual admitted operations,
   original diagnostics, receipt checks, failure and fresh-state assertions.
2. `owned directory operation and exact root receipt completes an owned mixed
   traversal under the authorized eight-million metadata cap`: unchanged
   callback SHA-256
   `10820ef3885a2efd7213734563949b3dfd4f7a9a0be92ff6a1dccdfed7312cf0`.
   Retains 16,384 generated entries, 1,029 linted, 15,365 unconfigured,
   1,209,401 actual metadata operations and every original assertion.

AST comparison preserves all 428 original assertion expressions (425 direct
expect calls and three asymmetric matchers), with seven new assertions.
Both stress callbacks are byte-identical; helper bodies have matching ASTs.
Actual case-ID multisets preserve all 248 published identities, including their
multiplicities, on all three Node versions. Captured full ordered-open arrays
match authenticated published traces exactly: 12 cap opens and 1,039 traversal
opens. The final diagnostic runs the actual stress callbacks, not a substitute.

The unpublished credential-deferral experiment and its eight new cases remain
sealed separately and are not included or reverted here. Published portability
and open-observation retention stay intact. The rejected guard-cache experiment
is not used.

## Completed qualification

New bounded control was authored and passed before extraction: one selected
case, 248 explicitly unselected. This is existing-behavior/refactor
GREEN-to-GREEN evidence, not a fabricated behavioral RED.

| Lane | Passed | Failed | Unselected/skipped |
| --- | ---: | ---: | ---: |
| Published Node22 baseline | 248 | 0 | 0 |
| Node18.20.8 unit / stress | 247 / 2 | 0 / 0 | 0 / 0 |
| Node22.22.2 unit / stress | 247 / 2 | 0 / 0 | 0 / 0 |
| Node24.14.0 unit / stress | 247 / 2 | 0 / 0 | 0 / 0 |

All these commands exited normally. The final candidate matrix totals 747
successful case executions. This successor refreshes the matrix after the single
approved import-consolidation fix. Earlier JSON-attribute/import-format fixes and
their matrices remain preserved, not double-counted as additional unique coverage.
Unit commands use the unchanged root config; stress commands use the new config.
Final commands, reporter JSON, logs and timing are in `evidence/unit-node*`,
`evidence/stress-node*` and `evidence/ordered-opens` in the successor stage.
The published baseline remains in the reviewed parent's stage at
`evidence/baseline-node22`.
These focused runs are not a full ordinary npm/workspace or hosted gate.

## Lifecycle controls and static checks

Actual Node22/npm10.9.7 controls verify successful posttest, argument forwarding,
unit failure preventing posttest, stress assertion failure failing the command
without bailing out the second case, missing stress files failing closed, signal
propagation preventing posttest, and the explicit workspace-only alias.
The disposable observation driver is not the production workspace runner.
The first signal expectation assumed shell status 143; raw child-process results
actually report null status/SIGTERM. That failed harness expectation remains
preserved and the corrected comparison passes against an actual native self-signal
control. No process-group or foreign-process action was used.

Explicit test/config strict closure uses the unchanged actual compiler options.
History: 10 published diagnostics, 15 before the JSON-attribute correction, 13
in the reviewed parent, and **10 after import consolidation**. The final
diagnostic code/message multiset exactly matches the published baseline; source
locations intentionally move. No declaration stubs, compiler relaxation, fake
types, assertions, suppression or production changes were added. The original
ten diagnostics are reported honestly, not called strict-green.

The shared fixture imports and directly re-exports the eight existing named/raw
namespace bindings used by the two suites. Named and namespace imports retain
their actual ESM live bindings; there are no wrappers or destructured snapshots.
Both suites consume these bindings from the same fixture module. Every helper
and callback body remains byte-identical to the reviewed parent. Static review
found no module mocks/reset hooks or dependency back-edge to the fixture.
Dependency evaluation now follows the shared fixture's imports; filesystem and
ESLint spies still execute after static imports. The existing complete test files
and actual ordered-open traces provide the behavioral oracle, not an assumption
that import order is textually unchanged.

The new helper, stress config, package manifest, new lifecycle test and new
unit import pass formatting. Whole unit/stress files do not: the published unit
file was already unformatted and the moved callbacks deliberately retain their
original bytes. No blanket formatting or prettier-ignore was added.

All requested bounded qualification checks have run. The unchanged package and
stress config reuse the hash-authenticated npm lifecycle proof from the reviewed
parent. Remaining external gates are current-main integration, actual ordinary
npm/workspace qualification and Feynman's required hosted workflow step.
Old hosted deadline failures remain
failures; no hosted acceptance, guard speedup, full strict success or release is
claimed. No commit, push, original/e28 edit, dependency change or cleanup occurred
during the component qualification.

## Current-main owner-aware integration

The successor starts at main e91ecba8bdd56c4dd9285a3bc64336ce479aec84,
not the superseded bc48 candidate. All 75 intervening changed paths remain
authoritative. In particular, the production guard's lower-only initialization
limits, both newly bounded unit bodies, the new limit-forwarding unit case,
native jobs and same-source-SHA dependencies, reporters, loaders and engine
changes are preserved. The removed foundation README section is not restored.

The complete current baseline runs 249 unit cases. Their callback bodies and
IDs are conserved exactly; one bounded initialization-failure lifecycle case
is added, producing 250 unit cases. The two original full-scale callbacks
remain byte-identical in the separate mandatory stress file. The parent 747
passes are historical component evidence, not this successor's matched proof.

Only eight paths change: the six component paths, the release workflow and
the root README. Existing workflow native prerequisites, env, jobs, needs,
permissions and concurrency remain unchanged. The Linux workspace step uses
`npm run test:workspaces -- --concurrency=4`, followed by the exclusive required
`npm run test:stress:lint` step bounded to seven minutes, before publication.
Ordinary `npm test` retains mandatory posttest instead; CI does not duplicate it.
The stress cases have explicit new 180-second budgets, not a claim that the
old 30/20-second unit deadlines passed.

Current-main native infrastructure is retained without overlaying the older
private qualification work. That private work may be superseded where remote
changes supply it; no blanket qualification or admission claim is made here.
The credential-deferral experiment remains superseded and excluded. The e28
runtime commit remains separately preserved with eight failed normal-hook
cases; it is not included or retried. Original checkout contents and metadata,
fonts and the CLAUDE.md symlink are untouched.

Matched successor tests, normal hooks and actual hosted results are recorded
in the operator evidence and subsequent receipt. Local success alone does
not establish hosted acceptance or a new published version.

The matched successor baseline passes all 249 current Node22 unit cases. The
reconciled complete files pass 250 unit and two stress cases on each of
Node18.20.8, Node22.22.2 and Node24.14.0: 756 passes, zero failures or skips.
All 249 baseline test identities and callback bodies are retained. Shared
helpers have identical TypeScript ASTs apart from their export modifiers;
the two full-scale stress callbacks retain the qualified parent's bytes.
Workflow lint passes. Parsed workflow comparison proves that only the
workspace invocation and required stress step change; all native jobs, env,
permissions, dependencies and same-SHA wiring remain intact.

Actual npm controls using the exact selected script strings and disposable
observation drivers verify argument forwarding, successful posttest, unit
failure preventing posttest, stress failure failing npm, and the explicit
workspace-only alias. Those drivers are lifecycle observations, not a
substitute for the complete real guard tests or ordinary workspace hooks.
