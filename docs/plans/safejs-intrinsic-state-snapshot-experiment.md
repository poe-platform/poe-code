# Intrinsic state descriptor reuse experiment

## Validated duplication and candidate

hasGuestObjectState checks registered intrinsic records by first capturing all
own descriptors, then enumerating the original object and reading descriptors
again. A new structural regression failed on one repeated descriptor read;
seven semantic controls passed (5780dc).

The candidate reused the captured descriptor dictionary and key list. It did
not cache across calls, change mutation/prototype/extensibility checks, or alter
budgets/timeouts. All 27 focused accounting tests passed (e76665), and TypeScript
passed (298c5e). The later broader selection passed 42 tests but timed out in
four namespace replay/checkpoint cases (29375f): both object/map three-completed
replays and the 25-step/1,800-step checkpoints. This was not a clean gate or a
demonstrated timeout repair.

## Interleaved measurement

The read-only source-runtime benchmark registers a 100-property intrinsic and
performs 5,000 unchanged-state checks per sample. Every check must report false.
Node 22.23.2, milliseconds:

| Version | Five samples | Evidence |
| --- | --- | --- |
| Initial baseline | 437.37, 263.15, 386.38, 388.51, 378.08 | 13f159 |
| Initial candidate | 243.43, 249.49, 232.69, 209.85, 230.85 | ecad74 |
| Repeated baseline | 196.80, 192.71, 185.15, 194.95, 188.19 | 1f95a2 |
| Repeated candidate | 303.75, 228.07, 238.83, 204.47, 233.09 | 4bf8ee |
| Final baseline | 185.46, 177.87, 186.05, 185.97, 177.80 | 880158 |

The initial apparent gain does not survive repetition. Earlier samples also
overlapped other local checks; this is not a controlled CI benchmark. Even the
microbenchmark provides no basis to retain the runtime change as a performance
improvement, and the actual replay gate still fails.

## Outcome

Rejected the runtime experiment. Only this turn's owned object-model hunk was
restored; unrelated existing changes remain untouched. Removed the new
implementation-specific assertion that required the rejected scan strategy.
Kept eight behavior-focused controls in intrinsic-state-detection.test.ts for
descriptor flags/values, symbol replacement/deletion, accessor identity without
execution, prototype/extensibility, NaN and signed zero. No existing regression
was deleted and no timeout or workload was reduced. The replay timing gap remains
open. The built artifacts predate this experiment and were not rebuilt during it.

After restoring the original runtime, the four-file focused selection passes
all 27 tests (ef501e), including the eight retained semantic controls. TypeScript
passes (ebabb7), and scoped test lint passes (3dd25b). The original descriptor-check implementation was inspected
again (908eb4); no part of the rejected runtime hunk remains.
