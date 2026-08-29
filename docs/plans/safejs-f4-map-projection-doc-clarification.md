# F4 Map projection documentation: incremental author addendum

August 29, 2026. Static documentation only; Curie independent review and root publication approval remain pending.

## Ordered scope

Add only “Canonical replay and outer projections” to `packages/safejs/CHECKPOINT_REPLAY.md`, preserving every other approved byte. This addendum is the second, new publication path. No runtime/type change, README/SKILL change, or new executable example.

- Prerequisite manifest: `/Users/kjopek/Workspace/poe-code-safejs-contract-docs-final-review/out/safejs-contract-docs-independent/dist/final-f4-qualified/manifest.json`, SHA256 `5bf03490eae48d14ec76a68190073d0b23ac959bab671f6f6907cf48948b9fc0`.
- Required incremental document preimage: `925aff82a7bb76e7f48297491923c52f2c3fc60be25926ceab01c54f4814dc9c` (21,205 bytes), the approved postimage staged only in this worktree. Frozen prerequisites are untouched.
- Publisher reports the old three-document group is not integrated: actual document baseline remains `b3c62930c236e3f1b1c9f64236c12449a0bdf73b104fcee3e3566eba256108d0`; both earlier plan paths remain absent. This increment does not apply directly to that baseline. Curie composes the complete group and independently reviews it; no publisher revert is needed.

## Evidence and preserved bounds

Source citations refer to `93dda91e9d0d7078e7940ba51bf73a81ed7aec49`, already verified in the sealed independent contract trace.

- Canonical identity/outcomes: `packages/safejs/src/interp/host-call.ts:136` cross-checks legacy identities/lifecycles then uses canonical records; `packages/safejs/src/interp/host-call.ts:485` decodes canonical outcomes with registered capabilities; `packages/safejs/src/interp/host-bridge.ts:311` supplies replay/onReplay outcomes. `packages/safejs/src/run.ts:226` excludes legacy loop restoration when canonical replay exists.
- Lossy outer markers: `packages/safejs/src/interp/host-call.ts:550` creates separate unnamed placeholders; `packages/safejs/src/snapshot/dump-format.ts:92` projects eligible data; `packages/safejs/src/dump.test.ts:145` expects non-callable markers. `packages/safejs/src/snapshot/validation.ts:139` still validates within-envelope references.
- No invented stability promise: `packages/safejs/src/snapshot/dump-format.ts:202` allocates traversal-local IDs. Fixed-fixture byte assertions at `packages/safejs/src/snapshot/serialize.test.ts:60` and full native Map assertions at `packages/safejs/src/snapshot/completed-map-alias.test.ts:124` remain unchanged.
- Migration binds the complete artifact: `packages/safejs/src/migrate.ts:46` hashes it; `packages/safejs/src/migrate.ts:97` sorts keys without normalizing refs; `packages/safejs/src/snapshot/migration.ts:64` checks the exact digest. `packages/safejs/MIGRATION.md:33` and `packages/safejs/src/migrate.test.ts:196` establish value-sensitive binding. Preserve original artifacts; do not rewrite fields or refs to reuse receipts.

Data manifest: `/Users/kjopek/Workspace/poe-code-safejs-version-profile-attribution/out/safejs-remediation/version-profile-attribution-cache/f4-map-dump-data-adjudication/manifest.json`, SHA256 `95aca4507247984d1124dfc31c6bdbcf89d37ad7d9c6bf3ae260e31b763c8acc`. Its `analysis/legacy-bijection-failures.json` and `analysis/exact-raw-comparisons.json` establish alias/name loss; `analysis/typed-identity-bijections.json` records exact canonical identities in the bounded captures. No claim that changed references are unreachable is made.

Independent contract manifest: `/Users/kjopek/Workspace/poe-code-safejs-o17-contract-independent/out/safejs-remediation/f4-map-dump-contract-independent/manifest.json`, SHA256 `fd4603551d6735037b3dd03cb67bc07fc6b2584ed9d44442124e8e96305ea29d`. Root accepted its scoped representation qualification, not unconditional legacy compatibility. **Four whole-dump and two legacy-journal equality failures remain FAIL.** No production fix, all-stack readiness, or security certification is claimed.

## Validation and handoff

Static checks: exact prerequisite hash, insertion-only delta, absent addendum preimage, whitespace, and captured postimage hashes. No runtime/build/install/test or formatter process; no original archive access. Existing F3/F4 evidence remains immutable. Curie independently reviews/composes this two-file increment with the earlier group; publisher rechecks final ordered preimages and waits for review/root approval. The separately approved 13 pure-QA paths are untouched. Quiet-window HOLD remains active.
