# Array write call-context reuse experiment

The unchanged 600,000-element spread test reproduces its five-second timeout.
Source inspection found that createArrayMethodOptions already creates a read
call context, but each write constructs another context and callback closures.
A regression recorded two distinct contexts for two fill accessor writes,
while confirming the expected setter values and receiver identity.

Experiment: reuse the method's call context for writes. Keep every write,
budget check, setter invocation, ordering, compilation owner and deadline.
Do not infer workload improvement merely from the context-identity test.

Three before measurements of the unchanged source interpreter workload:

| Run | Elapsed ms | Process CPU ms |
| --- | ---: | ---: |
| 1 | 13041.88 | 2351.66 |
| 2 | 19919.25 | 2527.16 |
| 3 | 12775.04 | 2323.06 |

The full integration suite was running concurrently; elapsed values cannot
establish an isolated performance comparison. Compare CPU as well as elapsed
time, repeat A/B/A, and retain the change only with representative evidence and
semantic checks. This is separate from previously rejected per-write await
removal and literal-context experiments.

The candidate passed 35 context identity, array prototype and data-budget tests,
plus TypeScript. The command's array-method test path was incorrect and did not
add that suite; use interp/methods/array.test.ts and its receiver suite in the
final selection.

Candidate measurements were 24797.50/10248.51/4082.95ms elapsed and
2162.70/1877.29/1806.18ms process CPU. CPU reduction is promising, but a baseline
recheck is required. Only this experiment's three-line runtime change has been
temporarily removed for A/B/A; all unrelated implementation remains intact.
The new identity test intentionally requires the candidate change and is not
expected to pass while the baseline is temporarily restored.

The repeated baseline measured 4581.79/5021.95/4499.10ms elapsed and
2160.05/2180.53/2115.49ms CPU. Both baseline groups have higher median CPU than
the candidate (2351.66 and 2160.05 versus 1877.29ms). This supports a CPU
improvement, not a guaranteed five-second wall-time pass under contention.
The candidate context reuse is restored. Correct array-method/receiver suites,
the unchanged complete interpreter tests and final lint are now running.

The final six-file semantic selection passed all 731 tests, including the
unchanged 600,000-element spread test, array methods/receivers, prototype links,
data budgets and context identity. Final focused lint passed. The
integration candidate does not yet contain this improvement.
