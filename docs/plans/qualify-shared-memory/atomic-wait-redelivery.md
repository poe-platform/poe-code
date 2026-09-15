# Atomic wait ownership and rollback delivery — 2026-09-14

Overall `qualify-shared-memory` acceptance remains open for raw/legacy host
histories and agent/runtime qualification. This report records delivery of the
previously local low-level wait repairs without adopting unrelated local work.

## Ownership and registration race

Starting from delivered remote main `069ae0b0913040c33feb0d8c07f0531d6d6c0dc8`,
the two regression files from local `8089068f6` reproduce **three failures**:
unowned activation, activation by a different owner after disposal, and an
independently injected mutation between the restored load and wait registration.
The last case resolves instead of rejecting, inventing a not-equal settlement.
No test was weakened or skipped.

The original 12-line runtime patch applies cleanly. Activation requires an active
run-resource owner, is idempotent only for that owner, and rejects the
registration race. Ordinary public raw-snapshot rejection and low-level paused
restore stay distinct. Source and tests are copied exactly from the earlier
local repair, then revalidated against remote-main code.

Node **22.23.2 / ICU 78.2**, Darwin arm64. Target remains ECMA-262 edition 16 /
ECMA-402 edition 12, June 2025, with unchanged newer-API and Test262 pins.

```sh
npx vitest run packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts
npx vitest run packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts
npx eslint packages/safe-js/src/snapshot/restore.ts packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts
npx tsc --noEmit -p packages/safe-js/tsconfig.json
```

Red: **3 failed / 2 files**, exit 1. Green: **19 passed / 3 files**, zero failures
or skips, exit 0. Scoped ESLint and package typecheck pass. The maintained full
package baseline at parent `069ae0b09` passed 29,651 tests / 47 explicit skips;
that remains a parent result, not a new full-suite claim for this patch. The
focused checks cover all changed low-level branches and existing continuation,
FIFO, cleanup and remaining-time neighbors. Raw local logs are
`/tmp/qualify-shared-memory-owner-{red,green,lint,types}.log`.

The enclosing Conventional Commit delivers this ownership/race repair. Local
commit, remote ancestry and publication receipts are recorded separately after
push. No original-workspace source or staged content is altered by this
redelivery: it already contains the prior local implementation.

Ownership alone does not roll back an earlier successful registration when a later one fails. The separate repair is qualified below.

Candidate restore.ts SHA-256: `da60c1b699a1a0a31b86cb84a7d52d6c27f45e7c26923230261f4631f96d26cc`.

## Partial activation rollback

Parent source: `85c0bb75933965e77c02a91f3c26af53acedf638` (verified on remote main).
The two unchanged integer/BigInt regression tests from local `0bf355700` both fail
against that parent: activation rejects before termination cleanup finishes.
The original runtime repair uses a child resource scope for the restored queue;
rejection waits for cleanup without aborting the external owner or original waiters.

Node 22.23.2 / ICU 78.2. Reproducible commands:

```sh
npx vitest run packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts
npx vitest run packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts
npx vitest run packages/safe-js/src/snapshot packages/safe-js/src/interp/atomic-wait.test.ts packages/safe-js/src/interp/globals/atomics-wait-disposal.test.ts packages/safe-js/src/interp/shared-callback-export.test.ts
npx eslint packages/safe-js/src/snapshot/restore.ts packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts
npx tsc --noEmit -p packages/safe-js/tsconfig.json
```

Red: 2 failures. Green: 21 tests / 4 files. Broader snapshot/disposal/callback
qualification: **2,336 passed / 173 files**, zero failures/skips, 90.30 seconds.
ESLint and package typecheck pass. No budgets, assertions or timeouts changed.
Logs: `/tmp/qualify-shared-memory-rollback-{red,green,snapshot,lint,types}.log`.
These are source-level checks; parent built-artifact results are not relabeled
as this source. Release receipts remain separate from the enclosing local commit.

Candidate `packages/safe-js/src/snapshot/restore.ts` SHA-256: `c040c6f509f464a52f10cbd8387441e5057c407c9d7f5369e6a0ddb6eb8209d8`.

Candidate `packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts` SHA-256: `1c7e860c3fb53f8d2b25890e2524c2a6314dab187b649d152faba30b7e10400b`.
