# Mutant binding correction v4 and retained collection attempt

The first task-checkpoint mutant is **BLOCKED**, not killed. Its mutation anchor
matched twice in emitted runtime.js (lines1368 and1847), so the loader's required
single-anchor assertion rejected before the intended test loaded. Raw stdout is
retained at logs/mutant-task-checkpoint/stdout. The node:test process-level row
reported a failure but that is not a semantic test result. An earlier progress
message calling both mutants meaningful was premature and explicitly corrected.

The cursor-publication mutant did load and fail the intended N05 assertion.
The new checkpoint-v2 loader binds the surrounding getopts-local checkpoint
declaration, retaining the single-anchor check and changing only its awaited
task yield into a microtask. The existing, previously passing tiny-final-flush
control is reused unchanged. No product file, oracle, timeout, loader allowlist
or candidate identity changes. Original failed loader and its logs stay intact.

The first collection attempt failed at collect.mjs:39 while requiring the absent
mutant-task-checkpoint-binding.json. No evidence-v1 output had yet been written.
It is a reviewer preseal failure (ENOENT), not a candidate failure. Collection v2
requires the successful retry's binding and an actual TAP assertion-code line,
rather than accepting an assertion-code substring in a loader stack trace.
