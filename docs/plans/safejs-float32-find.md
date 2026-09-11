---
title: Float32Array find
---

# Float32Array find

Confirmed absent by 10 failing native comparisons; one invalid-callback error
control passed coincidentally. RED log: `/tmp/poe-safejs-float32-find-red.log`
(1.38 seconds), recorded before implementation.

Cover callback arguments/thisArg, first-truthy short-circuiting, empty/no-match
undefined, preservation of NaN and negative zero, live writes, callback errors,
captured length over resize, subclass inheritance and ignored result coercion.
Critically, return the element read before the matching callback, not a second
read after the callback mutates that index or detaches its backing buffer.

Implemented through the shared callback bridge, preserving the element read
before invocation. Added promise results, direct detachment, two snapshot
round-trips and step-budget cleanup coverage. The harness checks callback-time
mutation across an await boundary; it makes no agent calls and does not test
model behavior. Deliver one atomic commit and push after qualification.

Qualification: all 498 tests across 34 buffer/Float32 files pass (18.00 seconds),
including 15 find tests. TypeScript and scoped ESLint pass. No matching open
GitHub issue was found. Behavior follows the published
[ECMAScript 2026 typed-array find algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.find).

The real harness passed after 70 uncached build tasks (59.858 seconds), and its
screenshot was inspected. The built SDK passed the callback-mutation captured
value check on Node 18.18.0.
