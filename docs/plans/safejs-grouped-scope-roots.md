# Grouped scope accounting roots

## Evidence and approach

Repeated `Scope.retainedDataRoots()` calls scan and flatten every binding even
when their identities have not changed. Cache one local group of the existing
per-binding roots. The data visitor can then skip an already-visited group.
Keep group nodes internal, uncharged and depth-neutral; do not change serialized
frames, guest values or the public `retainedValues()` contract.

Invalidate the owning scope when charged values or replacement membership change,
including declaration, assignment through a child/alias, copying and hydration.
Numeric-only updates reuse the group. Clear obsolete groups immediately, without
waiting for another measurement. Keep module/resource/private/import-meta roots
fresh outside the cache. Old groups retain their old binding snapshots; unchanged
bindings keep their identities so old/new groups do not double-charge them.

## Validation

- Four grouping controls failed on the original code. A copy fixture accidentally
  used a const source; it was corrected to let before runtime implementation.
- A further same-value replacement-membership case failed on the first candidate;
  membership changes now invalidate the cache independently of value changes.
- Corrected candidate passed 29 focused accounting tests, build and lint.
- No budget, fixture, timeout or maintained exclusion was relaxed.
- Full regression and downstream checks are required before delivery.

## Complete camera fixture CPU comparison

All samples use the unchanged full first camera case, native trace comparison,
fixed expected-output assertion, and existing budgets. No concurrent local
build/test/lint process ran during measurement. Times below are CPU milliseconds.

| Build | Four repetitions per fresh process |
| --- | --- |
| Initial baseline | 1557 / 1429 / 1377 / 1346 |
| Candidate | 1499 / 1379 / 1266 / 1299 |
| Candidate repeat | 1487 / 1363 / 1287 / 1274 |
| Rebuilt baseline | 1549 / 1453 / 1365 / 1356 |
| Restored candidate | 1492 / 1367 / 1281 / 1276 |

Each process executes four repetitions; later columns include normal JIT warmup.
The interleaved baseline remains consistent with the initial baseline, supporting
the observed roughly 4–6% CPU improvement. This does not prove CI timeout
reliability. The exact candidate diff was restored after the baseline rebuild;
fresh candidate build 89819 is running before final measurement and full tests.

Build 89819 passed all 23 workspaces and four imports. Restored-candidate benchmark
52183 passed every assertion, with wall times 1723/1672/1685/1447 ms. Full SafeJS
regression is now running as session 24460, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-scope-groups.gqy3EL6vpb`.
Source and tests are frozen for the run. Only the same two documented experimental
weak-collection/host-promise-property files are excluded; the new six grouping
controls are included. No commit or push of this candidate yet.

Downstream session 29695 passed 163 tests in 13 files (22.06 s). Built Node 18
checks passed grouped accounting and immutable old binding snapshots. A native
GC diagnostic allocated its object in a completed helper frame, measured the
scope, assigned zero, then collected it without another accounting pass; the
WeakRef cleared while the scope remained live. This confirms the group cache
does not keep that obsolete object alive. Full gate 24460 remains active without
reported failures; its camera cases passed at 4352/3477/2709 ms.

Full gate 24460 completed successfully: 20,241 passes, 37 skips, 683 passing
files and one skipped file (411.42 s). Build, lint, downstream, Node 18, memory
retention and interleaved performance checks all passed. No extra exclusions or
relaxed budgets/timeouts were introduced. Ready for its own main commit/push;
CI publication and continued camera reliability still require monitoring.
