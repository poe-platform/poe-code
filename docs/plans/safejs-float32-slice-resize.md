---
title: Float32 slice during buffer resize
---

Five native comparisons reproduced four failures when start/end conversion shrank
the backing buffer; a growth control already passed. Preserve the requested
result length, revalidate nonempty slices after conversion, and copy only bytes
still available. Empty results must not attempt to read out-of-bounds storage.

The real harness checks partial shrink with zero-filled trailing elements,
out-of-bounds receiver TypeError and a valid empty result. No agent spawn is
needed for this runtime-only probe.

Validation so far: 46 focused tests passed; the broader Float32 run passed all
201 tests across 14 files (unfinished species tests excluded). No lint/type
processes ran concurrently with that test run. Scoped TypeScript and ESLint also
passed. Real harness qualification follows.

The real harness passed after 70 uncached build tasks (59.154 seconds). Inspected
`screenshots/harness-run-docs-plans-safejs-float32-slice-resize.md.png`: Harness
passed, expected result fields, no errors and zero spawns as intended.
