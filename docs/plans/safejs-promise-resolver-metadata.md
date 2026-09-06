---
title: Promise resolver function metadata
---

## Evidence and implementation

Two initial regressions failed against native resolver function metadata. Promise
resolving functions should have an empty name and length one, with configurable,
non-writable, non-enumerable metadata properties. Use ordinary guest function
property tables while preserving their original settlement closures and retained
promise state.

Metadata mutation revealed two further public replay failures. Mark only actual
runtime-created Promise resolving functions in a private WeakSet and allow their
runtime metadata through the existing trusted run replay path. Source replay
reconstructs guest metadata changes. Arbitrary/copied snapshot roots retain the
managed-state rejection; this is not portable resolver-closure serialization.

## Validation and delivery

Eight focused cases cover name/length, descriptors, metadata mutation without
changing settlement, pending/completed replay, forged snapshot roots, and no
reissue of completed host effects. The Promise regression group passes 215 tests;
the final two boundary cases are verified separately.

Because snapshot handling is affected, run the maintained workspace unit route
excluding only the pending uncommitted native-Promise import policy tests, then
scoped lint/types, selected build, and this real CLI harness with screenshot
inspection. Commit and push independently, monitoring releases while validating
the next JavaScript gap.

The maintained workspace run passed 16,817 tests with 41 skips. The separate
Promise.try regressions were created after collection and are not included in
this commit or the passing count. Scoped lint and type checking passed.
