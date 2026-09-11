# Concurrent driver test ordering

Full maintained `npm test` run 43555 failed at the mixed pipeline/ralph integration
test: actual spawn order was ralph,pipeline; expected was pipeline,ralph. All
per-task event assertions passed, and both expected calls occurred exactly once.
The shared stage reported 20239 passes, one failure, and two skips. Subsequent
workspace stages were not run; this is not a full-suite success.

The scheduler calls startWorker without awaiting it for each available slot.
Each worker independently awaits ensureWorkspace before dispatch and driver
execution. Candidate selection order therefore does not guarantee agent-call
order across concurrently prepared workspaces. Serializing production workers
would alter intended concurrency merely to satisfy this assertion.

Compare the exact sorted list of called task IDs. This preserves multiplicity
and rejects missing, duplicate, or unexpected calls. Keep all existing per-task
ordered event assertions unchanged. No timeout, fixture, or production behavior
changes are needed. Run the Maestro workspace tests and focused lint before the
separate commit and direct-main push.

Validation: Maestro workspace run 81171 passed all 373 tests in 27 files;
focused ESLint run 52478 exited successfully. git diff --check passed.
No matching open GitHub issue was found for this ordering failure.
