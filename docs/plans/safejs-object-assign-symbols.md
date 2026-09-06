---
title: Object.assign symbol keys and live descriptors
---

Eight failures across nine tests confirmed missing symbol keys in normal and
direct builtin execution, plus missing late enumerability changes. Snapshot all
own string and symbol keys per source, then check presence and enumerability
immediately before each value read. New keys added by getters are not copied;
deleted keys are skipped. Existing host-object bridge access remains in use.

The first implementation made the direct adapter asynchronous and failed an
existing synchronous API test. Preserve that direct path, including trusted
native getter behavior, while giving both paths the same key-selection rules.
The original synchronous assertion remains unchanged.

The focused Object.assign, Object methods, accessor and host-bridge cohort
passed 157 tests across five files. Run scoped lint and types, the selected
workspace build, and this real CLI harness. Visually inspect its screenshot;
no agents or host capabilities are required.

Scoped lint and TypeScript passed. The selected build passed all four import
checks. The real CLI harness passed and its screenshot was visually inspected;
its root build completed all 70 tasks uncached. The next host-promise import
tests remain outside this commit and its focused green count.

Remaining follow-up: imported native promise own properties require preservation
without importing Node or host execution metadata as guest-visible properties.
