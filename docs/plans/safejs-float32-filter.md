---
title: Float32Array filter
---

# Float32Array filter

Next independent improvement after map. Source installation currently omits
filter; validate behavior against native tests before implementing.

Published ECMAScript 2026 section 23.2.3.10 validates the receiver and callback,
captures the initial internal length, and collects pre-callback element values
whose predicate results are truthy. Unlike map, species lookup and result
allocation occur only after all callbacks, including for an empty result.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.filter

Cover callback arguments/thisArg, empty/no-match, mutation, resize/detachment,
promise truthiness, species timing/result shape/aliasing, snapshots and retention,
allocation and traversal limits. Reuse the existing species path without moving
filter allocation ahead of callbacks. Keep this separate from map delivery.

Validated before implementation: 12 native comparisons fail, with one
coincidental invalid-callback TypeError control passing (1.19 seconds).
RED log: /tmp/poe-safejs-float32-filter-red.log. The regression file remains
uncommitted until the independent filter improvement is implemented and checked.

Implementation collects selected pre-callback values with array-length and data
checkpoints, then shares species lookup/allocation with map/slice/subarray.
Copying selected values preserves negative zero and converts undefined after
detachment to NaN. It does not re-read source elements after callbacks.
Additional tests cover species changes/errors during callbacks, promise order,
default subclass species, direct detachment and cleanup, two snapshot round-trips,
traversal/collection limits and combined interpreted data accounting.
The harness is a zero-spawn runtime/schema check, not proof of model behavior.

Verification: 610 focused Float32Array/ArrayBuffer tests passed in 40 files
(21.26 seconds). After reducing the data-budget test input tenfold, all 25 filter
tests passed in 1.48 seconds; exact-file ESLint was rerun and passed. Package
TypeScript passed. The actual harness completed 70 uncached build tasks (58.659
seconds), and its inspected PNG showed Harness passed with zero spawns. Built
SDK Node 18.18.0 smoke confirmed subclass results and pre-callback values.
No matching open GitHub issue was found. The reduce regression file was added
after the passing suite and is intentionally RED, outside this commit/claim.
