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

The separate partial-activation rollback repair from `0bf355700` still needs
fresh validation and its own atomic delivery; ownership alone does not roll back
an earlier successful registration when a later one fails.

Candidate restore.ts SHA-256: `da60c1b699a1a0a31b86cb84a7d52d6c27f45e7c26923230261f4631f96d26cc`.
