# DOCX packing resumption verification

Current task: `validated-docx-packing` only. Implementation and test statuses
remain open. Later tasks were not started. This record supplements the ordered
pipeline; it defines no format requirements.

## Git baseline and ownership

Started on `main` at `0cc5205b4137fba7dee9ec69ada03a79ba07997d`.
The index had no staged changes; its `git ls-files --stage` SHA-256 was
`ce824704c9bc0144cfc656e9f01720e082345355aec452a9b3b61546a93482e8`.

Preexisting modified paths: docs/docx/archive-extraction.md,
docs/docx/omml-equations.md, docs/docx/upstream-api-audit.md,
docs/plans/docx-omml-equations.md, docs/plans/docx-typescript-safe-bash.md,
docs/specs/docx.md, packages/docx/src/create-command.test.ts,
packages/docx/src/discovery-result-schema.ts, packages/docx/src/discovery.test.ts,
packages/docx/src/discovery.ts, packages/docx/src/extract.ts,
packages/docx/src/index.ts, packages/docx/src/inspection-command.ts,
packages/docx/src/operation-json-schema.ts and
packages/safe-bash/tests/commands/docx-registration.test.ts.

Preexisting untracked paths: docs/plans/docx-safe-packing.md,
packages/docx/src/archive-namespace.ts, packages/docx/src/pack-command.ts,
packages/docx/src/pack-inventory.ts, packages/docx/src/pack.test.ts,
packages/docx/src/pack.ts and the output/docx-archive-extraction-qa,
output/docx-dummy-text-qa, output/docx-removal-qa,
output/docx-sanitization-qa and output/docx-signature-qa directories.

Root owns this new record, integration/export decisions and Git coordination.
Leaf packing_review owns read-only independent investigation/review;
packing_verify owns read-only maintained workspace and supplemental Shell
verification. Leaf packing_correction owns the new
packages/docx/src/pack-inventory-negative-index.test.ts and only the added
`Number(key) < 0 ||` condition in preexisting pack-inventory.ts. No safe-bash
source, historical seal, export or registration membership was changed.
The existing registration test is registered by exact literal path in
packages/safe-bash/scripts/integration-inputs.test.mjs:2347.

## Contract and research baseline

The current authoritative specification already resolves the recorded
test-adaptation, allowEmpty and text-cardinality drift. Its image-sizing contract
uses native per-axis DPI rather than treating a stale plan phrase as authority
for an implicit pixel unit. No specification or README was edited.

Current input SHA-256 values, replacing the pipeline's historical snapshot for
this verification only:

| Input | SHA-256 |
| --- | --- |
| docs/specs/docx.md | 8b37234ad1e0f7706427c332479704792a0554e9615d26f686dc994e5a2ff28c |
| docs/specs/office-cli.md | cb5614e03c841f31d98efe4bcf2aabdb419926aa26775d17b401598d9a2d74ce |
| docs/specs/office-sdk.md | 1b2dd9f411621ebdc6ce24974e48f6143e0d3c9fe1191200207dfd6a3ddbfe64 |
| docs/docx/corpus-manifest.json | e77009a4942a6841184076ad7eb401725476ef5d8bc18ea74b1a5444acfb4b1f |
| docs/docx/upstream-api-inventory.json | 10955a17b17ac1b334c5854ce7048970f9033ddb0408322bef3e3586d19e44ac |
| docs/docx/upstream-test-inventory.json | 14c609ceb775158cb36c0423d24678b4a3e9f09d429085730b28103a759ad797 |

Corpus research currently records 23 real downloads and two separately counted
original examples. The audits/inventories retain 1,609 unit variants, 650 expanded
BDD cases and 920 reconciled API records. Those counts are preparation evidence;
this task verifies no corpus case, whole public API or adaptation campaign.
No download, native reference execution or fixture cleanup occurred.

## Reproduced defect and original regression

The closed inventory-array validator accepted an own negative integer key:
`entries["-1"]` or `directories["-1"]`. Independent review reproduced acceptance
against the current built implementation. The authoritative closed-input
contract requires rejection of unknown fields without caller callback execution.

Before correction, `npx vitest run
packages/docx/src/pack-inventory-negative-index.test.ts` exited 1: both rejection
tests failed and the ordinary-array test passed. After adding only the
nonnegative index condition, that regression plus pack.test.ts passed 29 tests.
The independent reviewer reran the regression: 3/3 passed, no further blocker
found within reviewed packing paths. Tests use original small metadata and make
no filesystem calls; no disk fixture or downloaded asset is required.

## Verification and completion limits

Independent supplemental pack/extract checks passed 55/55 tests. Supplemental
`node --import tsx --test
packages/safe-bash/tests/commands/docx-registration.test.ts` passed 16/16 tests,
including actual opted-in Shell packing, quoted Unicode payload retention,
stdin pipes, missing graph targets, destination/input-tree conflicts, symlinks
and cancellation. This direct single-file run is not the maintained whole
virtual-bash gate.

Initial `npm run lint --workspace=docx` passed its ESLint/source/test type checks
with one existing operation-types.test.ts unused type-only variable warning.
Maintained `npm test --workspace=docx` passed 154 files and 3,130 tests in
145.68 seconds. That run began before the new regression was authored; the
new regression's separate red/green and independent 3/3 evidence are above.
Post-correction `npm run lint --workspace=docx` also exited 0 with the same
single warning, including source and test type checks. No build, whole
virtual-bash gate, packed consumer, renderer
or screenshot pass is claimed by this resumption. The correction changes
closed-input admission, without a new CLI layout.

A targeted reference-identity search found no research-project identity in the
reviewed packing source/tests or DOCX adapter/registration paths. This is scoped
evidence, not a complete product-identity audit. Standalone legal notices remain
untouched.

## Delivery blocker

The current packing implementation and its dependency files predate this turn
and remain uncommitted. packages/safe-bash/AGENTS.md explicitly says never to
commit existing user changes. This record's owned documentation can be committed,
but the original regression cannot be committed as a working standalone change:
it imports pack-inventory.ts, which does not exist in the starting commit.
The narrow source correction and regression therefore remain uncommitted for
integration with the existing task work. No existing changes were staged or
committed. Packing cannot close under the task's atomic verified-commit gate;
schema/capability discovery and all later tasks remain pending.

No push, release, README edit, ignored-file commit, broad staging or hook bypass.
