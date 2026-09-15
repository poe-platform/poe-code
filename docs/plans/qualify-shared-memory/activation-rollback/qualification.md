# Shared-memory activation rollback qualification

Acceptance remains **OPEN**. This increment repairs rollback after partially
registering a restored queue. It does not implement early rejection of arbitrary
unrecorded external shared-memory histories.

## Candidate and target

Base source SHA: `ec59c216b5844b1e45e2709ec6bd7dfa6b6abf2f`, local main, plus
preserved dirty source. `source-before.json` records all existing SafeJS source
hashes, the staged-diff digest and the original ledger prefix. Execution host:
Darwin arm64, Node 22.23.2 / ICU 78.2. The final source receipt identifies the
actual candidate; the base commit alone does not identify these dirty bytes.

The target remains ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025), the
existing separately tracked newer APIs, and Test262
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`. No runtime floor, budget, assertion,
timeout, or host grant was changed. The pinned
[agent contract](https://github.com/tc39/test262/blob/419d3e0a2273ba01a3bfcbec423f2801425b8e93/INTERPRETING.md)
was inspected again. The web reader rejected the large edition document;
`published-clauses.json` records hashes and observations from direct retrieval of relevant
[published clauses](https://262.ecma-international.org/16.0/).

Native differential observations are semantic controls, not a substitute for
edition text. The earlier published DoWait BigInt-index wording reconciliation
remains open; this increment does not silently select draft wording.

## Validated repair: SM-ROLLBACK-1

The original deterministic regression registers two original waiters, restores
its own detached queue, successfully registers the first restored waiter, and
mutates the second location between comparison and registration. Both Int32 and
BigInt64 cases fail before the repair: native notify finds **one** residual
restored waiter after activation has rejected while the caller's owner is live.
`red.log`: two failures, exit 1. No wall-clock delay induces this race.

Activation now owns a child resource lifetime. Successful activation keeps that
lifetime until caller disposal. Failed activation waits for child cleanup before
rejecting and detaches that failed cleanup from the caller. It does not cancel
original waits or poison the caller's owner. Existing `withRunResources` performs
cancellation and joins disposal; a second cleanup implementation was not added.
Public envelope restoration, low-level paused reconstruction, owner identity,
same-owner activation promise identity, FIFO sorting, and saved remaining time
retain their existing contracts. No-wait activation still needs no owner.

The final regression independently gates termination completion, verifies that
activation cannot reject before the gate is released, checks zero native
residuals before owner disposal, and checks that rollback does not fabricate a
guest promise settlement. Original waits remain independently notifiable. These
are scheduling assertions, not bounded performance measurements. Real-worker
manual probes use a separately injected failure at the second comparison after
acknowledging the first registration, and check the same residual/owner controls
without the worker mock.

`green.log` and `gated-green.log`: 21 tests / four files passed, zero skips.
`lint-complete.log`: targeted ESLint passed; `test-typecheck-complete.log`: the new regression and its transitive production imports typecheck. Initial test typechecks failed on overloaded native notify calls, admitted-view narrowing and unchecked scope lookups; the correction uses Reflect dispatch and adds actual admission/found assertions without weakening the semantic assertions. The new test had not yet executed in the ongoing package run when these test-only edits were made; production source stayed unchanged throughout. `final-focused.log` reruns all four activation files after those corrections. The maintained workspace build closure
passed, including eight built-import controls. The package gate and upstream
results are recorded in the terminal receipts below; focused checks never replace
an incomplete or failed broad gate.

## Required runtime observations

`manual-qa.md` contains the executed procedures and exact stdin modules.
`runtime-matrix.json` retains exact executables, loader arguments, exit codes and
logs. Both Int32 and BigInt64 real-worker rollback controls pass on Node
18.18.0 / ICU 73.2, 18.20.8 / ICU 74.2, 20.20.2 / ICU 78.2,
22.23.2 / ICU 78.2, 24.21.0 / ICU 78.3, and 26.8.2 / ICU 78.3.
Original notify counts are `[1,1]`, restored residuals `[0,0]`, and the original
owner remains live in all cells. Every process exits after disposal.

`semantic-matrix.json` expands runtime evidence with eight integer/BigInt view
types, nine operations each (72 operation traces per runtime), original and
completed replay compared to independently executed native traces. All six
runtimes pass these comparisons. Immediate waitAsync mismatch/zero-timeout,
nonshared notify and the negative public blocking-authority control also pass
on all six. These are controlled schedules, not arbitrary-interleaving recovery.

Growth is a separate cell. Node20/22/24/26 pass the explicit fixed/tracking-view
result `[4,8,4,8,7]` originally and after completed replay. Both Node18 cells fail
with `TypeError: Growable SharedArrayBuffer requires host runtime support.`
Their final semantic processes exit **1**, intentionally retaining that failure.
This is an unimplemented required-runtime growth path, not missing permission to
block the host. No version-floor increase or skipped growth assertion is offered.
The initial semantic probes stopped at the uncaught growth rejection before their
negative controls; their `*-semantics-initial.log` files remain incomplete, and
the later complete observations are kept separately. The initial matrix's log
basenames refer to those initial logs before the `-initial` archival rename.

The two modules also pass against the Node22 built `dist` modules
(`built-probe-1.log`, `built-probe-2.log`). This is local built-artifact evidence,
not registry installation or release qualification. Bun/Workerd, other operating
systems and the full upstream matrix on each Node version remain unverified.

## Recovery exclusions and remaining blockers

The fresh `recovery-current.log` reproduces the unchanged counterexample.
`recovery-matrix.json` and its six runtime logs also reproduce the same incorrect
pending effect on **all six Node versions**. Their process exits are zero because
the observation procedure completed; the recovered semantics failed:

| Schedule | Original | Pending replay | Completed replay | Subsequent effects |
| --- | --- | --- | --- | --- |
| Synchronous write, return only | 7 | 7 | 7 | none |
| Queued write, return only | 7 | 0 accepted | 0 accepted | none |
| Synchronous write, then effect | 7 | 7 | 7 | `[7,7]` |
| Queued write, then effect | 7 | 0 accepted | argument mismatch rejects | **`[7,0]`** |

The host save operation runs once. Its queued mutation executes outside a recorded
transaction boundary. Pending replay issues an incorrect new effect before any
mismatch rejection. **SM-REPLAY-1/2 remain unresolved acceptance blockers.** The
previous change-and-undo witness still establishes that boundary journals need
not distinguish different intervening observations. Copying more boundary bytes
cannot prove absence of concurrent mutation. A complete repair requires an
enforceable capture/ownership protocol or tested early rejection of unsupported
histories, while preserving qualified transaction/alias paths. This repair adds
neither a trust flag nor a blanket removal of those paths, and claims neither
universal deterministic recovery nor safe early rejection of that class.

The independently reconstructed queue is private to its restore. Its FIFO result
does not assert restoration of an external agent cluster, native waiter identity,
or elapsed wall time while a snapshot is paused. Explicit agent suspension
authority remains confined to the conformance host; public execution stays
nonblocking. Actual host-resource termination failure is not a successful cleanup
receipt merely because activation rejects.

## Commands and delivery

Commands ran from `/Users/kjopek/Workspace/poe-code`:

```sh
npx vitest run packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts
npx vitest run packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts
npx eslint packages/safe-js/src/snapshot/restore.ts packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
npm test --workspace=@poe-code/safe-js
npx tsc -p docs/plans/qualify-shared-memory/activation-rollback/tsconfig.json
```

No CLI visual behavior, README or workflow changed. CLI screenshots and workflow
lint are therefore not applicable to this repair. Repository-wide gates are not
claimed; the production edit is confined to low-level SafeJS restore. No push,
remote-main verification, issue closure, registry publication or release workflow
was requested or performed. Release receipts: **none**. Local commit status and
all terminal gate counts are recorded below when available.


## Terminal gates and disposition

The complete maintained package command exits **0**: **30,144 passed / 47
skipped**, with **1,412 files passed / two skipped**, in 1,153.72 seconds.
No test failures or timeouts occurred. `package-test.log` preserves the complete
run. Skips are kept separate: 33 recorded filesystem-reference gaps; eleven
native-Temporal-dependent cases; two native-f16round comparisons; and one opt-in
parser fuzz profile. Those unavailable/opt-in observations are not counted as
passes. No optional profile was synthesized. This complete package result is not
a repository-wide `npm test` claim.

The pinned upstream command was executed only after package/build completion:

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/qualify-shared-memory-test262 --include built-ins/SharedArrayBuffer --include built-ins/Atomics --timeout-ms 3000 --report /Users/kjopek/Workspace/poe-code/docs/plans/qualify-shared-memory/activation-rollback/upstream.jsonl
```

`upstream.jsonl` completes **493 files / 986 variants: 968 passed, 18 failed,
zero unsupported**, exit **1**, with zero metadata errors, execution accounting
errors or timeouts. Final runner fingerprint:
`92ada3f4beabbe27ab7edc7811c92842cef7d32c4c060a1ec7a9c96bbde38578`.
`upstream-disposition.json` enumerates every failure: nine immutable-buffer
helper fixtures in both modes. These remain explicit nonpasses for the tracked
newer API; they have not been removed from the selection or reclassified as
passes. `upstream-agent-mapping.json` independently maps all **238** formerly
unsupported agent/blocking variants to their passing current results.

The earlier full-run BigInt timeout is not erased. Its fixture passes in this
complete current run at the same deadline, but this does not establish the cause
of the historical timeout or a reliability repair. No timeout was encountered
in this increment's full run requiring a focused replacement.

`change-and-undo.log` freshly executes the Markdown witness in
`../recovery-audit/qualification.md` against this candidate. It again reports
identical normalized boundary journals for different original observations.
This strengthens the missing-history counterexample; it is not early rejection.
The final SafeJS source manifest SHA-256 is
`61bcf0abe2a65b52ae0720a25154b8e1096c05b5d73b75faa4545f3b037f1429`.
All its per-file hashes were verified after the upstream run.

Only `src/snapshot/restore.ts`, the new `atomic-wait-rollback.test.ts`, and this
increment's evidence/ledger addition are owned changes. The index and all other
existing SafeJS TypeScript bytes are verified preserved. The full initial ledger
prefix is also preserved. The local repair and its evidence form the enclosing
Conventional Commit; obtain its SHA using
`git log -1 --format=%H -- packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts`.
**Verified remote-main delivery: none. Successful release/publication: none;
release receipts: none.** No push was performed. Acceptance remains open for
SM-REPLAY-1/2, minimum-runtime growth, and the remaining unverified/runtime and
edition-reconciliation cells described above.

Local staging review initially flagged terminal blank lines emitted by five raw test logs. `log-normalization.json` records text-only EOF normalization and preserves each byte-exact original in its adjacent `.log.gz`. This was a staging whitespace finding, not a test failure; all result lines are unchanged.
