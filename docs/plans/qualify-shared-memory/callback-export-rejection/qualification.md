# Shared callback export recovery — 2026-09-14

Acceptance for `qualify-shared-memory` remains **open**. This increment rejects
new captures of shared storage exported by guest callbacks. It does not claim
that boundary snapshots capture arbitrary host or worker histories.

## Source and target

Delivery candidate starts from fetched remote main
`da2ff844e7e72e96fc74e059e896822b0e920a86`, in a detached worktree at
`/tmp/poe-code-qualify-shared-memory-delivery`. No branch was created. The original
workspace remains on `947a383449d67460e060a5ac0ae77dcc87be6ad9`, with its 37 local
commits, 60 remote-only commits and pre-existing dirty/staged content preserved.
The code commit enclosing this report identifies the final candidate source.

Runtime: Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, Darwin arm64.
Target unchanged: **ECMA-262 edition 16 / ECMA-402 edition 12, June 2025**,
plus the ledger's separately tracked newer APIs. Test262 pin remains
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

## Reproduction and disposition

A callback returns a guest-created SharedArrayBuffer to its host receiver. The
host awaits the callback, writes 7, then settles. The guest reads 7. The original
remote-main implementation replays this completed execution as 0. The new test
first failed on that exact mismatch; original execution itself passed. This is a
separate callback-result boundary from the already documented shared-argument
and imported-host-result boundaries.

Merely registering the callback's exported buffer failed with `Invalid shared
host argument reference`: replay resolves outcome associations before callbacks
recreate those buffers. That experimental registration is not in the repair.
The explicit rejection test then failed because producer `replayError` was
undefined. Both failures are retained as red observations, not passing tests.

The repair marks callback shared-buffer exports during the existing recursive
copy operation, including views, nested aliases, promise fulfillment and thrown
or rejected data. It does not inspect accessors or add ambient host authority.
The journal refuses to construct a replay history using the existing
`MissingReplayCapabilityError` path. Completed original execution succeeds and
marks its snapshot with `replayError`; public restore rejects that snapshot
before execution. Pending replay dump refuses capture. Ordinary callback data
and confined guest shared memory retain successful recovery.

This is deliberately a capture capability restriction, not an ECMAScript
semantic defect or a promise of deterministic external-memory replay. Existing
public argument/settlement and low-level journal assertions are unchanged.
Low-level heap restore and owned `activateAtomicWaits` are unchanged.

## Independent scheduling

The worker regression passes the exported native buffer to a real worker. The
worker publishes readiness through a message and atomic word, then may block in
native Atomics.wait. The host advances through setImmediate before changing that
word and notifying. A second acknowledgement precedes the guest read of 7.
Storing the changed word before notify prevents a lost wakeup if native wait has
not yet registered. The worker is terminated in finally. Restore must reject and
must not call the host receiver again. No wall-clock sleep orders the writes.

The pending-capture test uses an explicit acknowledgement after the callback has
returned shared storage, then holds host settlement behind a promise gate. The
gate is always released and original execution is joined in finally. No tests
create files, query LLMs, weaken assertions/budgets/timeouts, or skip runtime cells.

## Commands and observations

Run in the detached checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node packages/safe-js/scripts/numberformat-data.mjs
npx vitest run packages/safe-js/src/interp/shared-callback-export.test.ts
npx vitest run packages/safe-js/src/interp/shared-callback-export.test.ts packages/safe-js/src/interp/shared- packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts
npx eslint packages/safe-js/src/interp/host-call.ts packages/safe-js/src/interp/host-bridge.ts packages/safe-js/src/interp/values.ts packages/safe-js/src/interp/shared-callback-export.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
npm test --workspace=@poe-code/safe-js
npm run prepare
git diff --check
```

Initial isolated test setup failed before executing tests because generated Intl
data was missing; the maintained data generator fixed setup. Before the worker
case was added, focused checks passed **119 tests / 11 files**, zero skips or
failures. Scoped ESLint passed. These are intermediate results only.

The first maintained package attempt lacked built dependency artifacts, causing
bundle checks to fail. It was interrupted with SIGINT (exit 130) after the worker
test was added; it is a draft, not a completed qualification run. The maintained
selected-workspace build closure and a fresh package run must qualify the final
candidate. Raw local logs use `/tmp/qualify-shared-memory-*.log`.

## Remaining blockers

- SM-REPLAY-1/2 for raw buffers exposed as host arguments remain unresolved.
  Queued writes and change-and-undo histories cannot be established from equal
  boundary bytes. Existing passing scripted boundary tests do not prove ownership.
- Legacy snapshots predating the new callback-export producer rejection are not
  retroactively qualified. An old unmarked callback history may still be accepted;
  comprehensive early rejection or an enforced ownership protocol remains open.
- Worker/agent implementation and upstream receipts in the original dirty tree
  have not been adopted into this isolated candidate. Historical 968/986 upstream
  results do not qualify this delivery source. No new upstream all-pass claim.
- Required Node18 shared growth, the published DoWait BigInt-index discrepancy,
  full backend/runtime conformance, Bun/Workerd and other platforms remain open.

No associated issue number was supplied, so no issue closure is asserted.
No README, CLI visuals, budgets, timeout, runtime floor, or target changed.

## Delivery

Local commit, verified remote-main ancestry, required workflow conclusions and
actual registry publication are separate receipts. All are pending until terminal
checks and delivery observations are appended. A successful partial repair does
not complete the overall task.

## Built runtime observations

The maintained selected-workspace build closure passed (23 builds derived from
the current manifest; eight built-import tests passed). [Manual QA](manual-qa.md)
passes from the built entry on all six exact Node versions in the
[runtime matrix](runtime-matrix.json): 18.18.0/ICU73.2, 18.20.8/ICU74.2,
20.20.2/ICU78.2, 22.23.2/ICU78.2, 24.21.0/ICU78.3 and 26.8.2/ICU78.3.
Each observes original 7, receiver count 1, explicit callback recovery rejection,
and confined wait/notify original and replay `[1,"ok"]`. The four candidate
[source hashes](candidate-source.json) distinguish this patch from the base SHA.

**Bun 1.3.11 is a nonpass, not a skipped or supported cell.** Its original
execution returns 0 rather than 7 before reaching recovery assertions. A native
control outside SafeJS independently reproduces broken shared aliasing:

```sh
bun --eval 'const a=new SharedArrayBuffer(4);const b=structuredClone(a);new Uint8Array(b)[0]=7;console.log(JSON.stringify({bun:process.versions.bun,distinct:a!==b,original:new Uint8Array(a)[0],copy:new Uint8Array(b)[0]}));'
node --eval 'const a=new SharedArrayBuffer(4);const b=structuredClone(a);new Uint8Array(b)[0]=7;console.log(JSON.stringify({node:process.versions.node,distinct:a!==b,original:new Uint8Array(a)[0],copy:new Uint8Array(b)[0]}));'
```

Bun reports `distinct:true, original:0, copy:7`; Node22 reports
`distinct:true, original:7, copy:7`. SafeJS's shared wrapper implementation uses
that native structuredClone primitive. The native/backend alias limitation is
not repaired, relabeled passing, or used to narrow the advertised runtime floor.
Full backend qualification remains blocked. This probe does not claim every Bun
version behaves alike. The installed executable identifies itself more precisely
as `1.3.11-canary.1+687700d84` in the retained failure diagnostic.

## Final candidate gates

`npm test --workspace=@poe-code/safe-js` completed with exit **0**:
**29,651 passed / 47 skipped**, **1,367 files passed / two skipped**,
1,177.66 seconds. All ten new regressions pass, including the independent worker
case. The source files were unchanged throughout this final run. Skips are
33 filesystem-reference cases, eleven unavailable native Temporal comparisons,
two unavailable native f16round comparisons and one opt-in fuzz case; none is a
pass. The earlier missing-build/interrupted draft is not substituted for this run.

Maintained build closure, eight built-import checks, final scoped ESLint,
formatted manual QA, candidate-source hashes and whitespace checks pass.
The built QA passes six Node cells; the explicit Bun native-alias nonpass above
remains unresolved. Screenshots are not applicable to this nonvisual change.

Fresh fetch still observes remote main
`da2ff844e7e72e96fc74e059e896822b0e920a86`; no reconciliation was necessary.
The original workspace/index has not been modified by this candidate checkout.
Local commit and publication receipts are appended separately after delivery.

Final package log SHA-256: `3d7cfa17dcf8bb6097cc02b407950dbd6ef5eacd7d69c012838c0b1912314f73`.
