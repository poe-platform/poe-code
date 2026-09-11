# Issue 708 validation: replay-equivalence test timeout

The full maintained unit run failed the coverage-demo replay-equivalence test at
5,381 ms against its 5,000 ms deadline. The other 20,365 shared tests passed.
An isolated run passed in approximately 2.2 seconds, establishing load-sensitive
work rather than an import timeout inside the test.

CPU profiling measured approximately 260 ms of repeated linting (13% of the
2.05-second profiled case), 233 ms of schema extraction, and 995 ms of runtime
budget reconciliation. Linting is avoidable work in this unit test, not its
dominant cost. The full maintained gate must establish adequate behavior after
the change; the isolated profile alone does not prove that the timeout is fixed.

Mock only the SafeJS lint dependency within the replay-equivalence test file.
Keep actual interpreter execution, schema extraction, every captured and
completed snapshot replay, source-hash checks, host-call journal, and result
comparison. Do not change product code, add runtime caches, change the template,
reduce replay coverage, or increase the test deadline.

Separate loader tests continue to use real linting for coverage-demo validation,
diagnostics, fixes, required exports, and allowed globals. Validate both the
focused replay file and maintained agent-harness workspace tests, then rerun the
full maintained gate. Preserve the original timeout and profile evidence.

The seven focused replay tests and the maintained agent-harness workspace suite
(13 files, 163 tests) pass. Independent review approves the exact test boundary.
The complete maintained `npm test` rerun subsequently passes, including the
20,366 shared tests and the original five-second replay deadline.
