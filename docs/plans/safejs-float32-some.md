---
title: Float32Array some
---

# Float32Array some

Confirmed missing by 11 failing native comparisons; two error-only controls
passed coincidentally. RED evidence: `/tmp/poe-safejs-float32-some-red.log`
(1.51 seconds), recorded before implementation.

The regression cases cover first-truthy short-circuiting, false for empty/all
false receivers, callback arguments and thisArg, result truthiness without
primitive conversion, live writes, captured length across growth/shrink,
callback exceptions, invalid callbacks, subclass inheritance and initially
out-of-bounds views.

Implemented the published [ECMAScript 2026 some algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.some)
using the existing callback traversal, with first-truthy short-circuit and false
on exhaustion. Added direct detachment, promise-result, two snapshot round-trips,
retention and step-budget cases. All 483 tests across 33 buffer/Float32 files
pass (16.63 seconds), including 17 some tests.

The harness checks short-circuiting after a callback shrink, across an await
boundary. It has no agent calls and does not test model behavior.

TypeScript and scoped ESLint passed. The real harness passed after 70 uncached
build tasks (61.656 seconds); its screenshot was inspected. The built SDK passed
short-circuit and empty-array checks on Node 18.18.0. No matching open issue was
found.
