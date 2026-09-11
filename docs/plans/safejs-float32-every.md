---
title: Float32Array every
---

# Float32Array every

Ten native comparisons failed before implementation; two error-only controls
passed coincidentally. RED evidence: `/tmp/poe-safejs-float32-every-red.log`
(1.03 seconds).

Follow the published [ECMAScript 2026 algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.every):
validate the typed receiver, capture length, validate callback even when empty,
read each initial index and invoke callback with value/index/receiver and thisArg.
Return false at the first falsy callback result, otherwise true. Convert results
only to boolean; objects and promises are truthy without primitive conversion or
awaiting guest promise settlement. Callback resize does not change loop length.

Share the established forEach callback traversal with every's short-circuit and
completion results. Tests include truthiness, empty/invalid callbacks, thisArg,
live writes, resize, callback exceptions, ignored thenables, promise ordering,
direct detachment, two snapshots, retention and step exhaustion. Small views
over large buffers keep retention tests fast.

The harness verifies early termination and undefined values after a shrink
callback across an await boundary. It has no agent calls and does not test model
behavior.

Qualification: all 466 buffer/Float32 tests across 32 files pass (15.75 seconds),
including 19 every tests. TypeScript and scoped ESLint pass. No matching open
GitHub issue was found.

The real harness passed after 70 uncached build tasks (58.523 seconds), and its
screenshot was inspected. The built SDK passed empty-array success and
short-circuit checks on Node 18.18.0.
