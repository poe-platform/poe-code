# Snapshot adversarial input: capability lookup recheck

The prior entrypoint inventory and qualification remain in [the original audit](../audit.md). This increment rechecks those claims on local main `f4bd98107cf0f9bd3f98b4c17bd3198af0f20049` plus the preserved dirty worktree, and adds one independently reproduced repair. It does not attribute the dirty candidate to a clean checkout of that SHA.

The target is unchanged: ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and the ledger's explicitly tracked newer APIs, including Temporal `e8cc03fc970a65a3359e8870e3b35e687ac94e55`. This is a transport/host-authority contract finding, not an added ECMAScript requirement. Runtime: Node 22.23.2, ICU 78.2, Darwin arm64; complete runtime and working-source hashes are in `source-before.json` and `source-tested.json`.

## Validated additional defect: SNAP-ADV-CAPABILITY-TABLE

`prepareReplayInputs` follows a saved capability path through an explicitly supplied Promise. For the forged path `["bindings","owned","properties","missing"]`, its lookup used `getPromiseProperties`, which installed an empty table on the original Promise before reporting the missing capability. The malformed input was rejected, but the table survived. No host operation was invoked; the defect is retained engine-owned metadata on an existing input.

The in-memory regression first fails at `promiseProperties.has(promise)`: expected false, received true (`capability-red.log`, one failure, 12ms test time). The expanded pre-repair controls give one failure and three passes (`capability-controls-red.log`, 18ms). The repair changes that lookup to the existing WeakMap's non-allocating `get`. It does not invent a capability, change the accepted paths, or invoke the capability.

The four new regression cells check:

- A rejected forged path leaves the absent table absent and invokes neither Promise preparation nor capability-restored callbacks.
- A valid supplied capability nested in an existing table resolves with exact identity, preserving that table without calling the operation.
- A scheduler observes an already installed replacement table, then throws; rollback restores the absent-table state.
- The same late failure restores the exact previous table with its original property.

The two scheduler controls pass before this repair. They independently establish that the earlier rollback test was not merely passing because validation rejected before mutation. No runtime rollback change is made on that basis.

## Entrypoint and acceptance coverage

The inventory was rechecked at public Node restore/migration exports, shared run engine, CLI/file routing, interpreter restore, replay input/data decoders and host-call/Promise journal constructors. File backends parse transport; semantic validation occurs at restore/migration/run. Host-operation authority still comes only from supplied bindings and resolvers. Internal scheduling/observation hooks are trusted integration hooks; arbitrary effects deliberately performed inside them are not rollbackable.

The broad selection retains the complete snapshot directory plus public restore/migration, memfs migration-file, external checkpoint validation, budget, host-call graph, Promise replay/header/import, roundtrip/crash-resume and mutation suites. Final scope additionally includes external checkpoints, replay-input allocation budgets and pending imported-Promise checkpoints. The agent-harness loader integration is checked separately. No CLI presentation changed; a screenshot is not claimed.

Coverage includes absent/unknown/contradictory tags, extra fields on closed records, dangling references and duplicate identities, private/prototype ownership, legal alias/reference cycles versus illegal wire cycles, source/version errors, oversized strings/keys/arrays, explicit capability authority, weak registrations, atomic wait activation cleanup, intrinsic cleanup, and compile/live-data rollback. Extensible metadata is not reclassified as an illegal serialization tag. The 96-case seed `0x5a902026`, 750ms corpus cap and 2s test timeout remain unchanged. Existing explicit version 1/2 cyclic fixtures, jobs-v6–v9 resume fixtures and jobs-v1–v9 migration fixtures remain in scope.

## Reproducible commands

Run from the repository root on the recorded working-source state:

```sh
npx vitest run packages/safe-js/src/snapshot/replay-capability-validation-qualification.test.ts
npx vitest run packages/safe-js/src/snapshot/replay-capability-validation-qualification.test.ts packages/safe-js/src/snapshot/replay-inputs.test.ts packages/safe-js/src/snapshot/replay-transaction-qualification.test.ts packages/safe-js/src/snapshot/promise-capability-properties.test.ts packages/safe-js/src/snapshot/input-symbol-references.test.ts packages/safe-js/src/run.replay-input-allocation-budgets.test.ts
npx tsc -p packages/safe-js/tsconfig.json --noEmit
npx eslint packages/safe-js/src/snapshot/replay-inputs.ts packages/safe-js/src/snapshot/replay-capability-validation-qualification.test.ts
npx vitest run packages/agent-harness/src/loader/agent-results.test.ts
```

The exact broad baseline and final commands are retained in `command.txt` and `final-command.txt`; their complete outputs are `acceptance.log` and `final-acceptance.log`. Tests generate graphs in memory, and maintained file integration tests use memfs. No model queries, budget changes, relaxed assertions, runtime exclusions or timeout increases were introduced.

Baseline: 188 files / 2,617 passed, zero failures/skips, 128.76s. Focused repair: 6 files / 44 passed, zero failures/skips, 3.10s. TypeScript and scoped ESLint exit 0. Final breadth and delivery disposition follow below.

## Final verification and disposition

Final expanded acceptance: **192 files / 2,633 passed, zero failures, zero skips and zero unhandled errors**, 104.02s. The separate maintained harness loader suite passes **7/7**, 4.69s. TypeScript and scoped ESLint exit 0. Expected red receipts are retained; no observed failure is hidden or counted as a pass. Full root/package suites and independent Bun/Workerd runtime runs were not repeated for this narrow lookup repair. The prior unverified runtime cells remain unqualified.

`preservation.json` verifies that only `replay-inputs.ts` changed among all pre-existing SafeJS TypeScript sources; the new regression is separately recorded. Tested source hashes remained stable and the unrelated staged Safe Bash patch remained byte-identical. The existing evidence ledger is updated by appending this increment; inherited edits are preserved.

**Local delivery:** this increment is committed separately with its tests and evidence; the resulting SHA is retained in the post-commit receipt. **Remote-main delivery:** no push requested or performed in this turn. **Release receipts:** none for this increment; previous local repair receipts must not be mistaken for remote publication. Existing divergent-history/clean-delivery and independent runtime qualification gaps remain open. This is a passing local Node qualification, not a claim of complete released-runtime acceptance.

Raw logs are committed as deterministic `.log.gz` archives; `log-receipts.json` records the uncompressed SHA-256 values. Read with `gzip -dc <name>.log.gz`. The initial staging whitespace check rejected Vitest’s trailing blank lines in six text logs. Lossless archival preserves the exact outputs and allows the whitespace check to pass; no test output was edited. Original `.log` files remain available locally.
