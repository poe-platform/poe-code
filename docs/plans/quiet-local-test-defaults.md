# Quiet local test defaults

The complete local test command still emitted tens of thousands of passing Node
test names and encoded evidence because concise reporting was CI-only. Use the
same concise Node reporter locally, and default Vitest to its dot reporter.
Keep full failure details, warnings, summaries and progress. Explicit Node
reporter/destination arguments and Vitest reporter overrides retain control.

Node reporter selection follows TDD; all 14 reporter tests pass locally and with
CI enabled. Real Node probes retain failure stacks, diffs, both output streams,
diagnostics and async warnings. Twenty ownership tests pass with the default dot
output and again with explicit verbose output. No discovery, worker, concurrency,
timeout or lifecycle changes. The running full suite is not restarted or hidden.
