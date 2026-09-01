# Current-shell bounded serial fixtures — September 1, 2026

## Authority and scope

The current driver/test changes are authorized separately from the August 27
fixed-revision `42baad3` acceptance audit. That historical audit and its seals,
frozen cases, native expectations, receipts and captured data remain unchanged.
Its old acceptance does not validate this new batching implementation. No live
unit test or package test script invokes `current-shell/acceptance-run.mjs`.

Only current-shell `current-shell.test.ts`, `run-product.mjs`,
`product-child.mjs`, new `product-fixtures.mjs`, and this plan may change.
Shared cohorts, production code, concurrency and frozen benchmark checkouts are
outside scope.

## Design and controls

Use bounded serial batches of eight, matching the existing shell-stress pattern,
with fresh Shell/MemoryFileSystem setup and disposal for every fixture. The
generic `runVirtualBatch` cannot represent the current-shell host provenance,
exact cancellation-reason identity and limit witnesses; retain their original
execution/assertion code in a cohort-local fixture runner instead. Reuse this
cohort's existing detached process-group supervisor and 8-second outer deadline.
Add an independently armed worker watchdog for each row, also bounded at 8s.
An outer failure invalidates every row in the affected batch, with no retries.
The outer 8s budget is shared, not multiplied by eight; heavier future fixtures
may require smaller batches. No concurrency or deadline relaxation is introduced.
Only process-global imported module state is shared, not fixture Shell/FS state.

Keep each child's before/after source census per row and require it to match the
parent's batch-wide before/after census. Preserve every row's fixture digest,
observations, expected values and assertions. Validate exact outcome count/order.
All 43 named rows remain; six bounded children replace 43 individual children.

TDD controls cover bounded launches, exact ordering, truncated/reordered/duplicate
outcomes, fixture/source drift, process failures, fresh shell/FS, and a late
synchronous hang. A watchdog-bypass negative control must hit the outer deadline,
whereas the real per-row watchdog must kill the child before that deadline.
Two finite cases cumulatively exceed the shortened test-only row deadline before
the late hang, proving that the watchdog is rearmed per case rather than shared.

## Baseline and validation

Fresh unmodified source run: 43/43 passing (32 native-parity, 11 host-contract),
43 distinct child PIDs, 16.187s wall time. Exact observations are retained in
memory for the after comparison; historical artifacts are not rewritten.

The three targeted isolation controls fail before implementation (missing batch
entrypoint/fixture module and unsupported guarded late-hang execution), then pass.
All 14 batching/control entries pass, including the watchdog-bypass negative
control. The original 43-row test body and extracted fixture function bodies are
retained unchanged apart from explicit fixture parameters on the latter.

After: 43/43 passing, six distinct child PIDs, 5.035s driver wall time versus
16.187s before (11.153s / 68.9% less). Deep comparison against the in-memory
baseline confirms every row ID/order/cohort, validity/pass result, native and
historical match, expected value, complete observation, fixture digest and
per-row source guard is identical. These are single local measurements, not a
full-CI or release timing claim.

Final canonical file run, including all added controls: 58/58 test entries pass,
zero skipped/cancelled/failed, 7.173s wall time; its original cohort parent takes
4.147s. Command, from `packages/safe-bash`:

```sh
node --import tsx --test --test-concurrency=1 tests/shell-stress/current-shell/current-shell.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node tests/shell-stress/current-shell/current-shell.test.ts
```

Focused strict TypeScript checking passes. All 37 other pre-existing files in the
cohort are byte-identical to the before snapshot, including `acceptance-run.mjs`,
`support.mjs`, frozen cases and all captured JSON. No Git, raw/root ESLint,
historical capture, shared-cohort or production edits were performed.

## Driver SHA-256 before this change

| File (relative to current-shell) | Before |
| --- | --- |
| current-shell.test.ts | `fa803152d6d4f179345e476202c7dafc5dc3f5af1006b49404dcec0a23770253` |
| run-product.mjs | `55d1b910802c22fee2fc98a0779aa38a85f608adf453a031d3bff6829b5338b5` |
| product-child.mjs | `58bd29a8205bbfc3c697a3388c358ab4bdf7bf0533391b497cd7200de9d3343a` |

## Driver SHA-256 after current validation

| File (relative to current-shell) | After |
| --- | --- |
| current-shell.test.ts | `8098554d16d5dd66ef866070370f9df25011bc7d467a291f307af346756013bf` |
| run-product.mjs | `19fd8d19f3a4dbaf5feb68a77cb9d3ea4f22e63a5d809dd56aaf78ac6a56e044` |
| product-child.mjs | `0992df7ac3e1fb09f9f4a4f55303c3249d112becac8ca7679a2775a662099213` |
| product-fixtures.mjs (new) | `fffac4a0f4a91c2cf40c471bb12b18511da99a04b75663abc8ef3339382e7925` |

These hashes describe the newly tested drivers only. They do not supersede or
reinterpret the old acceptance receipts, source hashes or historical validation.
