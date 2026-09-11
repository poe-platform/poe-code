---
title: Float32Array findLastIndex
---

# Float32Array findLastIndex

Independent improvement after findLast. The installer did not expose
findLastIndex; failing native comparisons validated the gap before implementation.

Published ECMAScript 2026 section 23.2.3.14 requires initial ValidateTypedArray,
captured internal length, descending FindViaPredicate, and returning its index.
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.findlastindex

Cover reverse traversal and first-truthy short-circuiting, empty/no match,
callback arguments/thisArg, positive-zero result, live writes, resize/detachment,
invalid callbacks and errors, promise truthiness, snapshots and resource limits.
Keep this separate from findLast delivery.

Validated before implementation: 10 native comparisons fail; one coincidental
invalid-callback control passes (1.07 seconds). RED log:
/tmp/poe-safejs-float32-find-last-index-red.log.

The shared callback traversal now returns the matching reverse index or -1.
Additional tests cover promise job order, direct detachment, retained storage,
two snapshot round-trips and traversal limits. The paired harness is a zero-spawn
runtime/schema check, not proof of model behavior.

Verification: 559 focused Float32Array/ArrayBuffer tests passed in 38 files
(19.11 seconds), including 15 findLastIndex tests. Package TypeScript and
exact-file ESLint passed. The actual harness completed 70 uncached build tasks
(58.896 seconds); its PNG was inspected and showed Harness passed, zero spawns.
Built SDK smoke passed on Node 18.18.0. No matching open GitHub issue was found.
The map regression file was added after the passing suite and is intentionally
RED, outside this commit and passing claim.
