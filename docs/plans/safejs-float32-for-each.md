---
title: Float32Array forEach
---

# Float32Array forEach

Eight native comparisons failed before implementation; two error controls
passed coincidentally. RED evidence: `/tmp/poe-safejs-float32-for-each-red.log`
(1.29 seconds).

Follow the published [ECMAScript 2026 algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.foreach):
validate the receiver, capture length, require a callable callback even for empty
arrays, and invoke it with value/index/receiver plus thisArg for every initial
index. Read each value at callback time, including undefined after shrink or
detachment. Ignore callback results and return undefined. Do not await returned
guest promises.

Implementation uses the existing callback invocation bridge, step accounting
and retention scope. Tests cover callback arguments/receiver, live writes,
growth/shrink, abrupt completion, invalid callbacks, ignored thenables, async
callback ordering, direct detachment, two snapshots and budget cleanup.
The retention control uses a one-element view backed by 12,000 bytes to verify
storage liveness without thousands of unnecessary callbacks.

The harness checks callback traversal after shrink across an await boundary.
It has no agent calls and does not test model behavior.

Qualification: all 447 buffer/Float32 tests across 31 files pass (16.85 seconds),
including 17 forEach tests. TypeScript and scoped ESLint pass. No matching open
GitHub issue was found.

The real harness passed after 70 uncached build tasks (58.7 seconds), and its
screenshot was inspected. The built SDK passed callback argument, thisArg and
undefined return checks on Node 18.18.0.
