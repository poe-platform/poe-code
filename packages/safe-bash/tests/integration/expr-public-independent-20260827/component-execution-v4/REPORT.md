# EXPRPUBLICCOMPONENT v4: HELD

Authorization date: August 28, 2026. Recipe: 8a28b7bffa5ef093cff2374ec32cba4ec4ca83f0.
Recipe manifest SHA-256: 71ec5ec3a8b27cdcb0e3c6bfa27eec9b4d12396022f76d950c5b38ee9a2e1179.

- Actual entry exit: 1; aggregate outer exit: 1.
- Reader: qualified; reused v3 16/16 qualification, no new reader controls.
- Minimal-repair controls: 28/28; qualified.
- P01: pass; runtime artifact: independently rebuilt exact fullpack.
- Runtime: 0 pass, 0 fail, 104 unrun /104.
- Types: 0 passed /40, 1 executed.
- Package controls: 9 passed /36, 9 executed.
- Observed child closure: true; finalization: pass.

- installed-node22-type-positive: Expected values to be strictly equal:

false !== true

- installed-node22-type-negative: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-N01: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-N02: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-N03: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-N04: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-N05: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-N06: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-combined: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- installed-node22-type-broken-declaration: integrity failure holds type admission
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

- runner: AssertionError [ERR_ASSERTION]: earlier integrity/lifecycle failure holds dependents
+ actual - expected

+ 'installed-node22-type-positive: nonnatural or unclosed process'
- undefined

    at context (file:///Users/kjopek/Workspace/safe-bash/tests/integration/expr-public-independent-20260827/component-execution-v4/run.mjs:102:10)
    at file:///Users/kjopek/Workspace/safe-bash/tests/integration/expr-public-independent-20260827/component-execution-v4/run.mjs:268:48
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)

Accepted-DU and original gate HELD/unrescored. HTML accepted separately; not rerun. No whole76/fullgate/engine acceptance. V1/v2/v3 preserved; one v4 invocation, no retry. Chunk transport is bounded separately from the pinned 4,644,868-byte retained JSON; no whole-RSS or constant-memory claim.
