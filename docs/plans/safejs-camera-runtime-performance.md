---
title: Camera workflow accounting performance
---

# Camera workflow runtime performance

Validated release failure: CLI run 34113167645, commit
1bb5572c8300d255f09aa6c1798829c43040b6b7, failed its shared unit gate on
2026-09-07. All three `interp/float32-camera.test.ts` cases exceeded the 5,000ms
test timeout; logged case durations include 6,294ms and 5,314ms. The gate otherwise
reported 35,306 passing tests and 42 skips. Scoped SafeJS publication succeeded
independently as 0.1.355.

The same complete camera fixtures pass locally, including in the SafeJS package
run during Uint8Array integration. Passing on the faster local machine does not
resolve the CI failure. Profile the built runtime on the unchanged fixtures to
identify the costly paths before changing them. Investigate repeated graph
accounting, parsing/intrinsic setup and asynchronous primitive operations.

Do not increase the timeout, remove the complete trace assertion, reduce camera
points or bypass the release gate. Preserve all original fixture inputs, native
trace comparisons, floating-point word checks and sandbox resource limits.
Validate an optimization with focused regression tests and before/after runtime
measurements, then its own commit and push. Continue monitoring publication.

Initial built-SDK CPU profile on 2621c56c8 (Node 22, profiler enabled):

- Axis/frustum: 2,322ms, 11,794 budgeted steps, successful result.
- Oblique/frame: 2,114ms, 11,206 steps, successful result.
- Offset/handoff: 1,380ms, 9,957 steps, successful result.

The largest self-sample groups were `measureSandboxData`'s recursive `visit`
(633 plus multiple separate stacks), `trackIntrinsicState`'s retained-value
callback (457), garbage collection (180), and `getSandboxPrototype` (157 plus
other stacks). These identify repeated graph accounting and intrinsic-state
inspection as the first optimization targets, ahead of guessing that arithmetic
or native Float32 operations are slow. Source locations are
`interp/values.ts:measureSandboxData` and
`interp/object-model.ts:trackIntrinsicState`. The CPU profile was held in memory;
no fixture, timeout, or production code was changed for profiling.

Any caching must still detect guest descriptor/prototype mutations, mutable
host-owned state, accessors and retained closure values. Never trade away data
budget enforcement or silently omit graph edges to improve timing.

Status: CI failure validated and initial profile captured; first optimization
implemented below. These initial measurements include profiling overhead and
are not a claim that the slower CI timeout has been resolved.

## First optimization: empty compile-ticket escape scans

`reconcileCompiledValues` always remeasured escaping graphs when a parent scope
existed, even when the full resource scan found no compiled tickets. A focused
regression confirmed two capture traversals instead of one before implementation
(one failure and one passing budget control, 1.02s).

Skip only that ownership-only second scan when the included-ticket set is empty.
The complete data graph is still measured, budget enforcement is unchanged,
completed-ticket reconciliation still runs, and graphs containing regex tickets
still take the original escape-ownership path. This is not a graph cache.

Verification: 202 tests passed across 16 files (10.89s), covering compile-guard
ownership, regex tests, data budgets, record measurement and unchanged camera
fixtures. TypeScript and ESLint checks passed. The real harness pair passed
after 70 uncached workspace build tasks (60.498s) and root bundle stages; its
screenshot was inspected. This harness makes no model calls.

Matched built-SDK measurements without the profiler, two rounds per fixture,
Node 22, no competing local test/build workloads:

| Fixture | Before (ms) | After (ms) | Steps | Peak data |
| --- | --- | --- | --- | --- |
| Axis/frustum | 1861, 1850 | 1663, 1493 | 11794 | 7161 |
| Oblique/frame | 1645, 1617 | 1601, 1502 | 11206 | 6550 |
| Offset/handoff | 1303, 1493 | 1128, 1364 | 9957 | 5939 |

Aggregate runtime decreased from 9769ms to 8751ms (10.4%). Every full trace
matched the fixture and every step count and peak-data value was unchanged.
These are small local samples, not a stable performance guarantee or evidence
that CI timeouts are resolved. Continue profiling the larger intrinsic-state
and graph-traversal costs while monitoring the new release gate. No matching
open GitHub issue was returned by the camera-timeout search.

## Second optimization: realm-free prototype lookup

The post-first-fix in-memory CPU profile still showed `getSandboxPrototype`
among the hotspots (169 plus 28 self-samples); graph visiting and intrinsic
retention remained larger. Inspection confirmed that after explicit links are
checked, every default-prototype result requires a supplied budget/realm.
Nevertheless, calls without that realm still classified buffer/view kinds.

A focused regression reproduced four redundant view-brand checks for five
realm-free values (one failure, two passing controls, 1.07s). Return null after
the explicit-link check when no realm exists. Keep explicit links, including
explicit null, and all realm-specific fallback behavior intact. This does not
cache prototypes or alter graph measurement.

Focused verification: 182 tests passed across nine files (9.59s), including
intrinsic mutation tracking, explicit/prototype boundaries, data budgets,
generator prototypes, Uint8Array persistence and all unchanged camera traces.

TypeScript and ESLint passed. The same real harness passed after 70 uncached
workspace build tasks (57.89s) and root stages; the new screenshot was inspected.
The next two built-SDK camera rounds were axis 1963/1748ms, oblique 1564/1676ms,
offset 1252/1186ms. All traces, step counts and peak-data measurements were
unchanged. These samples do **not** establish an end-to-end speedup from this
second change (aggregate 9389ms versus 8751ms in the preceding sample). Its
verified improvement is eliminating unnecessary classification work. The CI
timeout investigation remains open; pursue the larger accounting hotspots.
