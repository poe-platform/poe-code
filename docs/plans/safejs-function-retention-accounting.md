---
title: Mutation-aware function retention accounting
---

The recurring inverse-camera fixture timeout is validated by CLI release
34074441829. Descriptor scanning of unchanged intrinsic function tables remains
on the per-step accounting path. A focused regression reproduced three needless
descriptor reads on an unchanged table. This change avoids those scans without
changing interpreter steps, accounting limits, fixture assertions or timeouts.

Function property tables are privately created and exposed only through an
internal proxy that observes successful native and guest property definitions
and deletions. Cache descriptor-derived retained references by table revision.
Always check sandbox prototype changes and recursively measure retained objects;
untracked ordinary intrinsic objects still use a fresh descriptor scan. Capture
all roots before invoking retained-value callbacks, preserving their ordering
and duplicate-root accounting. Extensibility checks remain uncached; freezing
changes descriptors through the same observed definition path.

Focused tests cover unchanged scans, native assignments/definitions/deletions,
symbol properties, accessor captures without invocation, descriptor flags,
failed definitions after preventExtensions, freeze, nested mutable objects,
prototype changes and callback mutations between measurements. Existing function
property and snapshot tests are included in the focused cohort.

Qualification: run scoped lint and TypeScript, the full maintained SafeJS unit
task, the selected workspace build with native ESM smoke tests, and the actual
paired harness with a viewed screenshot. The two unresolved Promise import-policy
tests and eight next-task generator intrinsic tests remain explicit exclusions,
not passes. Measure the unchanged built inverse-camera fixture before/after
with retained Budget.stepsUsed and peakDataSize; do not infer CI reliability
from a single local timing or green release.

The initial test failed on three redundant descriptor reads; all 87 focused
tests pass after implementation. Scoped ESLint and TypeScript pass. The selected
workspace build passed 23 build tasks and all four native ESM smoke tests.
With tests/typechecks/builds stopped during both isolated timing batches, the
built inverse-camera runs took 2,223/2,037/2,122 ms before and
1,678/1,627/1,618 ms after. Every run completed with 11,558 steps and 7,123 peak
retained-data units. This supports a local accounting improvement, not a claim
that shared CI can no longer time out.

Full qualification passed: 17,444 tests and 41 declared skips in 508 passing
files and one skipped file, 223.36 seconds. The two exclusions above remained
explicit. No matching open GitHub camera-timeout issue was found to close.

The actual paired harness passed; its screenshot was viewed. The maintained
screenshot route completed 70 uncached build tasks in 60.308 seconds before
bundling and running the CLI.
