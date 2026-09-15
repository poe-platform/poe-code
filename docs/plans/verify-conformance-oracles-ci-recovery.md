# Oracle delivery: CI resource-policy recovery

Source: `1fd8137547c3e6963eb52f80147b418d1f126235`; local Node 22.23.2, ICU 78.2.

The evidence-only successor [Release 34712378521](https://github.com/poe-platform/poe-code/actions/runs/34712378521) failed its uncached SafeJS unit gate. The deterministic adversarial corpus (seed `0xad5c2026`) completed its semantic checks but took 761.1 ms against its existing 750 ms resource-policy limit. This is a harness performance failure, not an ECMAScript mismatch. The prior implementation release and its verified registry receipts remain valid. This successor is not a successful no-release result.

Inspector sampling identified intrinsic registration as a material repeated startup cost. Registration enumerated the same frozen well-known-symbol catalog for every symbol property and repeated the closure-brand check for each visited object. Cache the immutable symbol/name metadata once and reuse each object's brand result. The cache contains native symbols and names only; it retains no budget, guest object, or realm. Keep identity traversal, aliases, realm registration, unknown-symbol rejection, host authority, resource budgets, test timeouts, and all corpus cases unchanged.

TDD counterexamples use only memory fixtures. Before the lookup cache, a 64-root graph caused 960 catalog enumerations; the test permits at most one. Before brand-result reuse, a proxy counting brand inspections observed two queries where one suffices. Both controls failed before their respective repairs and pass afterward. The catalog test also verifies every generated symbol identity resolves to the exact original object.

Validation (raw logs under `verify-conformance-oracles/delivery-20260912`):

- `npx vitest run packages/safe-js/src/interp/intrinsic-symbol-registration-cost.test.ts` reproduced each counterexample (`symbol-catalog-red.log`, `closure-brand-red.log`).
- `npx vitest run packages/safe-js/src/interp/intrinsic-symbol-registration-cost.test.ts packages/safe-js/src/interp/intrinsics.test.ts packages/safe-js/src/interp/intrinsic-realm-identity.test.ts packages/safe-js/src/interp/budget-realm-views.test.ts packages/safe-js/test/adversarial packages/safe-js/test/conformance packages/safe-js/src/snapshot/intrinsic-mutations.test.ts packages/safe-js/src/snapshot/mixed-realm-intrinsics.test.ts packages/safe-js/src/snapshot/symbol.test.ts packages/safe-js/src/snapshot/symbol-registry.test.ts packages/safe-js/src/snapshot/symbol-accessor-replay.test.ts packages/safe-js/src/snapshot/symbol-replay.test.ts`: 333 passed, 27 files, zero failures/skips (`recovery-green.log`).
- `npm run build:workspaces -- --workspace=@poe-code/safe-js`: passed, including seven maintained import checks (`recovery-build.log`).
- `npx eslint packages/safe-js/src/interp/intrinsics.ts packages/safe-js/src/interp/intrinsic-symbol-registration-cost.test.ts`: passed (`recovery-lint.log`).

The alternating same-process registration benchmark preserves all 943 IDs in order. Cache-only medians, excluding two warmup pairs, are 1.7754585 ms before and 1.305438 ms after. Raw pairs and runtime are in `symbol-catalog-benchmark.json`. This is a registration microbenchmark, not proof of an end-to-end wall-time improvement: standalone corpus timing ranges overlapped. The unchanged CI gate must pass on a successor containing the repair. No CLI visual behavior changes; no screenshot test is added.

Delivery procedure: fetch, preserve concurrent work and staged changes, commit only this repair and its evidence, push through normal hooks, verify remote ancestry, and follow both root/scoped release workflows through publication. Verify exact registry versions, tarball integrity, SLSA source/workflow, and installed artifacts independently. Record post-push receipts in the ledger. Until that completes, successor recovery remains pending. No associated issue number was supplied.
