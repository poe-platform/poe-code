---
title: Float32Array metadata accounting allocation
---

# Validated allocation overhead

The camera timeout remains open after CLI release 34071655189 failed its
five-second inverse-coordinate trace test. CPU profiles still identify retained
accounting as the dominant cost. This change removes one concrete source of
unnecessary allocations; it does not claim to resolve all camera CI latency.

`float32DataProperties` previously materialized descriptors and entry tuples for
every numeric element, only to discard all of them. Enumerate own string names,
skip canonical numeric names first, and read descriptors only for metadata.
Preserve descriptor flags, identity and order, symbol/accessor rejection, and all
budget checks. A native 100,000-iteration microbenchmark over 16 elements plus
one metadata field took 293 ms before and 74 ms with this approach. This is a
path-specific measurement, not an end-to-end speedup claim.

The current built camera CPU profile attributes only six of 1,265 samples to
this helper's call stack (inlining may affect attribution). Therefore this
optimization is not evidence that the camera timeout has been fixed; the larger
intrinsic-retention cost still needs investigation.

TDD: the allocation regression failed before the implementation change (one
descriptor dictionary allocated instead of zero); three semantic controls passed.
Afterward all four tests and a 54-test Float32/camera/accounting cohort passed.
The complete camera fixtures and native trace assertions are unchanged.

Run the maintained SafeJS package suite because this helper also participates
in copying, host bridges and snapshots. Explicitly exclude only the separately
tracked native-Promise import-policy and generator-own-property red tests; these
are not claimed as passing. Then run the selected build and actual harness pair.

Qualification passed: 17,373 tests, 41 declared skips, 506 passing files and one
skipped file in 252.53 seconds. The two exclusions above remained explicit.
Scoped ESLint and TypeScript checks passed. No matching open GitHub camera,
Float32Array or generator issue was found to close.

The first actual harness screenshot exposed a separate existing limitation:
guest Object.defineProperty rejects typed arrays ("Typed array property
descriptors are not supported"). The final harness uses ordinary metadata
assignment to exercise this allocation change; the direct helper tests retain
non-default descriptor coverage. Guest typed-array descriptor support remains
an explicit JavaScript-completeness gap, not a passing claim from this change.

Selected build passed 23 dependency-closure tasks and four native ESM smoke
tests. The initial screenshot route built 70 uncached tasks. After correcting
the harness scope, the already-built CLI passed the actual pair; the generic
screenshot route captured that same built CLI and its passing screenshot was
viewed. No production code changed after full-suite qualification.
