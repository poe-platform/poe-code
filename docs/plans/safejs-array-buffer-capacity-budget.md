---
title: ArrayBuffer capacity budgets across boundaries
capacity: 128
---

# ArrayBuffer capacity budgets across boundaries

Guest ArrayBuffer construction checks maximum capacity against arrayLength,
whereas code inspection suggests host imports and snapshot restores do not.
The new in-memory probe compares construction, initial bindings, host-operation
results and primary snapshot restore using the same capacity and budget. Run it
before treating these suspected inconsistencies as validated bugs or changing
production code. Do not run it concurrently with the active metadata build.

This is independent of array method metadata and must have its own commit once
validated, implemented and qualified. Resizable capacity matters even with a
small current byte length because the backing reservation is made at creation.

Validated: construction rejects capacity 512 with arrayLength 128, while both
host import routes and primary snapshot restore accept it. Three RED cases and
one construction control passed in 1.35 seconds. Evidence:
`/tmp/poe-safejs-array-buffer-capacity-budget-red.log`. Production code is not yet
changed. Next inspect budget-aware value allocation and decoding paths, then
enforce the same maximum-capacity rule before creating backing storage. Include
view aliases and valid within-budget cases so the fix does not break sharing.

Expanded evidence found the same missing check in produced buffers/views and
budget-owned replay decoding. The initial six cases had five failures and one
construction control; after the first implementation, the replay probe still
failed. Logs: `...-expanded-red.log` and `...-replay-red.log` under the same
`/tmp/poe-safejs-array-buffer-capacity-budget` prefix.

Imports and produced-value checks now use resizable maximum capacity. Host view
imports validate before copying the backing storage. ArrayBuffer decoding accepts
the active budget, supplied by primary restore and budget-owned replay, and checks
capacity before allocation. Fixed Float32 element-count behavior remains unchanged.
Positive tests cover exact-limit buffers and shared view identity through imports,
primary restore and replay. Native allocation spying verifies excessive host
buffers/views are rejected before a new backing store is constructed.

Buffer host-compatibility publication verified: @poe-platform/safe-js@0.1.321,
run 34096078500, receipt 2026-09-07T07:38:38.6678394Z. Metadata scoped run
34096437551 and CLI run 34096437756 remain active.

Qualification: 335 focused tests passed across 25 files in 13.35 seconds. Full
SafeJS unit route passed 17,933 tests, with 41 skips, across 539 passed and one
skipped file in 290.45 seconds. The unresolved host-Promise import-policy probe
remains explicitly excluded, as in prior full runs; no other exclusions changed.
Full log: `/tmp/poe-safejs-array-buffer-capacity-budget-full-unit.log`.

Metadata scoped publication is now verified: @poe-platform/safe-js@0.1.322,
run 34096437551, receipt 2026-09-07T07:45:14.1605292Z. CLI publication remains
separate and unverified for that commit.

Final scoped TypeScript and ESLint passed. Actual harness passed after 70
uncached build tasks (59.392 seconds). Inspected
`screenshots/harness-run-docs-plans-safejs-array-buffer-capacity-budget.md.png`:
clean pass, expected capacity/values fields, zero spawns. Negative capacity
enforcement is proven by the unit boundary tests; this harness validates the
positive runtime/schema path and does not claim model behavior.
