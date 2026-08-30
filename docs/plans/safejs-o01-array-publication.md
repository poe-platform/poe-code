# Bounded Array callback mutation

## Scope

Implement inventory dispatch `O01-ARRAY-CALLBACK-MUTATION` for the already
modeled Array callback methods: `map`, `filter`, `forEach`, `flatMap`, `some`,
`every`, `find`, `findIndex`, `findLast`, `findLastIndex`, `reduce`,
`reduceRight` and `sort`. Do not add iterators, classes or unrelated features.

The only production delta is in
`packages/safe-js/src/interp/methods/array.ts`. Retain sandbox-owned receiver
enforcement, execution/data budgets, shared running-state cleanup, modeled
own metadata and method shadows, aliases, recorded callbacks and replay.
No Map production override or shared budget-policy fork is included.

Iteration methods capture their native visitation range and read subsequent
values/membership live. Append, delete, splice, length changes, holes, nested
callbacks, throws and `thisArg` follow the method-specific native contract.
Presence-skipping methods and the hole-visiting find family remain distinct;
reducers retain direction and initial-accumulator behavior.

Sort collects the initial sortable items and applies its bounded writeback and
deletion behavior. Stable ties with a consistent comparator are covered.
Comparator side-effect call order is implementation-dependent: this is not a
promise of a universal V8 comparator trace or unrestricted JavaScript support.

## Publication allowlist

Publish only these twelve author paths after all remaining approvals:

- `packages/safe-js/src/interp/methods/array.ts`
- `packages/safe-js/src/interp/methods/array-callback-mutation.test.ts`
- `packages/safe-js/src/interp/methods/array-callback-replay.test.ts`
- `packages/safe-js/src/interp/methods/array-nested-reads.test.ts`
- `packages/safe-js/src/interp/methods/lang-01-validation.test.ts`
- `packages/safe-js/src/interp/running-state.test.ts`
- `packages/safe-js/src/interp/methods/mapset-callback-mutation.test.ts`
- `packages/safe-js/test/array-observer-contract.test.ts`
- `packages/safe-js/test/array-worker-contract.test.ts`
- `packages/safe-js/test/fixtures/array-observer.ts`
- `packages/safe-js/test/fixtures/array-worker.ts`
- `docs/plans/safejs-o01-array-publication.md`

The two shared Map/running-state test deltas are the already-reviewed Array
composition and proper test-typing changes. The unchanged Map replay test
remains a validation dependency, not an author publication delta.

Do not automatically publish verification recipes, intermediate plans, failed
ready directories, raw journals, output snapshots, manifests, logs, caches or
other files under `out/`. Preserve them as independent review evidence. Use the
explicit `publication.patch` and allowlist, never a historical all-path patch
or blanket staging. No README, SKILL, master ledger, branch, commit or push is
part of this author task.

## Integration and evidence

The prepared source base is
`ea469259a7d61ab2839457863c445bd9f95155cb`, including delivered Map commit
`0750017f6fa71054a4b5cf6e4961139a01788b9d` and String source
`02eb156d801673a1382ad0851c9fbff9a99c4a71` with its paired upstream README.
Prototype and actual String 13.0.2 scoped prerequisite approvals are recorded
separately; neither certifies this Array change. The publisher must verify the
actual delivered dependency identities and then-current preimages again.

Native-oracle TDD history and all REDs remain preserved in verification
capsules. Observer controls recorded 12 RED / 13 pass, then 25 GREEN; process
receipt controls recorded 5 RED / 3 pass, then 8 GREEN. The current ea469259
selection has 556 passes across twelve Array/Map/observer/String files, with
complete selected typing, lint and the then-current 19-path formatting gate
exiting 0. Those receipts predate this consolidated plan and the corrected
capture-binding text; they are not new formatting passes for these documents.

Fresh affected package builds and canonical node/browser bundles passed.
Their raw metafiles contain 36 output rows: 28 published reachable files and
eight explicitly policy-pruned absences. Corrected capture reuses the existing
pure reachability helper with exact declared roots/cwd, preserves every raw
row, and rejects any absent required output. It does not filter by existence
or invent hashes for absent files. The failed first seal remains a failure.

## Remaining release gates

Workers remain on HOLD until a separate root GO names the sealed ready-v2
manifest. Run one approved seven-worker native/source/built/fresh flow only.
Retain full typed graphs, prototypes, descriptors, aliases, whole returns and
journals; never normalize actual results into an expected shape. Zero process
exit alone is not graph PASS. Completed zero-repeat checks are distinct from
the intentional pending-callback two-reissue controls. `CHECKPOINT_REPLAY`
qualifications do not imply blanket whole-dump byte-idempotence.

The two approved compact outcome writes remove indentation only. Keep both
complete observations and unchanged checkpoint bytes. Bounds remain 8 MiB per
evidence file, 32 MiB per whole worker, 2 MiB captured output, 192 MiB old-space,
10 seconds per worker, 90 seconds for the coordinator and at most one second
cleanup verification. No sharding, cap increase, automatic retry or new telemetry
is authorized. Full-cohort fit and V1/V2 closure remain unproved.

Original Array cases `language:03-typescript-stable-sort-reduce` and
`language:07-reduce-self-mutation` remain unavailable and unrerun. Newly authored
native fixtures do not close that original-case qualification. Extra confirmed
gaps remain separately tracked, not silently added to this scope.

After full raw-contract adjudication, obtain independent Averroes review and
root-controlled current integration/publication approval. Publisher owns the
later full-root and actual-release validation; do not duplicate that full suite
in this bounded author phase. This plan and the ready capsule are not release
authorization.
