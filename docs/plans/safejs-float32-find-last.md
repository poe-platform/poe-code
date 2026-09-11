---
title: Float32Array findLast
---

# Float32Array findLast

Independent improvement after findIndex. Source inspection showed findLast
was not installed on the typed-array prototype. Native comparisons validated
the behavior gap before implementation.

Published ECMAScript 2026 section 23.2.3.13 requires initial ValidateTypedArray,
captured internal length, descending FindViaPredicate, and returning the captured
value (not re-reading it after the callback).
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.findlast

Cover descending order and short-circuiting, empty/no match, callback thisArg,
live writes, callback-induced growth/shrink/detachment, invalid callbacks,
promise truthiness, snapshots, storage retention and traversal limits. Keep its
implementation and commit separate from findIndex.

The shared callback traversal now supports descending iteration and returns the
captured element on the first truthy predicate result. Tests additionally check
promise job order, direct detachment both with and without a match, retention
cleanup, two snapshot round-trips and traversal step limits. The harness is a
zero-spawn runtime/schema check, not proof of model behavior.

Validated before implementation: 10 native comparisons fail and one coincidental
invalid-callback control passes (1.12 seconds). RED log:
/tmp/poe-safejs-float32-find-last-red.log. No findLast implementation is included
in the preceding findIndex commit.

Verification: 544 focused Float32Array/ArrayBuffer tests passed in 37 files
(18.68 seconds), including 16 findLast tests. Package TypeScript and exact-file
ESLint passed. The actual harness completed 70 uncached build tasks (62.15
seconds); its PNG was inspected and showed Harness passed with zero spawns.
Built SDK smoke passed on Node 18.18.0. No matching open GitHub issue was found.
The separately prepared findLastIndex regression file was added after the
passing suite and is intentionally RED, outside this commit and passing claim.
