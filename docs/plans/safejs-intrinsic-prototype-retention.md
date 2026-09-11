---
title: Intrinsic prototype retention
---

# Intrinsic prototype retention

CLI release 34156449071 failed two camera trace tests at their existing 5,000ms
limit, with 36,299 other tests passing. The scoped SafeJS package release for
that commit succeeded; this is not evidence of a successful CLI publication.

The earlier camera profile identifies prototype lookup and intrinsic retention
as hot paths. A new focused regression proves every retained-data capture looks
up an unchanged tracked intrinsic prototype. Baseline: one failing optimization
regression and one passing multi-owner prototype mutation control.

Candidate: attach shared prototype state only to tracked intrinsic objects.
Update that state at every write to the explicit prototype table, including
Object/Array prototype installation and explicit null links. Retention reads
the shared state instead of repeatedly querying the WeakMap. Keep descriptor
scans for mutable native records; preserve prototype validation and snapshots.

Source-level camera measurements, same first case, seed, limits and tsx command:

- Baseline milliseconds: 2277.03, 2140.80, 2188.84, 2178.67.
- Candidate milliseconds: 2130.62, 2092.12, 2086.51, 1849.95.

These suggest a modest improvement, not a proven resolution of CI timeouts.
Seventeen focused retention checks pass. Camera, prototype and symbol checks:
42 tests pass in 8.97 seconds. No limits, timeouts or camera coverage changed.

Still uncommitted: require comparable built-artifact measurements, mutation and
restoration coverage, lint/types and full package verification before delivery.
The separate weak-collection probes currently remain intentionally red; do not
describe a package run containing them as green or silently omit them.

Changed-file ESLint passed. Before rebuilding, the current built SDK (settled
resolver delivery, without this candidate) produced camera baseline samples
1994.89, 1702.78, 1598.65, 1688.96 milliseconds. Use the same built-SDK command
after the normal build for the candidate comparison.

Normal build passed all 70 declared workspace build tasks and root stages.
Built candidate milliseconds: 1771.78, 1608.20, 1718.32, 1479.48. The comparison
supports a modest improvement, but the distributions overlap and CI publication
still must establish whether the timeout is resolved. Added rejected-cycle and
non-extensible-write accounting checks; all 13 focused retention tests pass.

Starting the maintained package regression route with two explicit exclusions:
the uncommitted weak-collection feature probes and the separately documented
host-promise property-admission probe. These are not claimed passing or solved;
the committed package coverage and candidate regression tests remain enabled.

Resolver commit 7514010d0 published as @poe-platform/safe-js@0.1.394 in workflow
34157582872 at 2026-09-07T20:02:24.3811794Z. It does not contain this candidate.

Final changed-file ESLint passed; both changed TypeScript files have zero
diagnostics. The paired real CLI harness passed with zero spawns, and its PNG
was inspected. It checks changed Array.prototype inheritance across awaits,
parent mutation, cycle rejection and restoration of the original prototype.
The package regression run is now active with the two explicit exclusions above.

Final regression result: 616 files passed, one skipped; 19,511 tests passed,
41 skipped, no failures, in 344.16 seconds, with the two explicit experimental
probe exclusions described above. This optimization is ready for its own commit
and push. It is not yet proof that the separate camera CI timeout is resolved.
