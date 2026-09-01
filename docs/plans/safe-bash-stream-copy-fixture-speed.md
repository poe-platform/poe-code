# Stream copy-regression fixture runtime

Date: September 1, 2026. Status: completed.

## Objective and scope

Reduce redundant fixture volume in
`packages/safe-bash/tests/commands/streams.test.ts` without weakening the
linear-copy regression or changing production code, test limits, concurrency,
helpers, frozen artifacts, or evidence. This document accompanies the test change.

## Completed plan

- [x] Inspect the fixture and check maintained seal ownership.
- [x] Measure the full file and establish a quadratic-copy negative control.
- [x] Reduce only the three fixture counts and repeat the negative control.
- [x] Compare all case names, run the full file twice, and check lint/types.

## Change and coverage

The sole test edit changes `[521, 2081, 8329]` to `[37, 131, 521]`.
The existing observer rebuilds its queue/backing-buffer census on every input
chunk, making large fixtures expensive independently of command copy behavior.
The unchanged fixture shape is `[count, ...Array<number>(count + 13).fill(1)]`;
total input chunks per dimension fall from 10,973 to 731.

All eight head/tail × Buffer/Uint8Array × immutable/reused cases retain their
exact names and three scales, for 24 parameterized runs through the real command
path. The old smallest scale remains the new largest. Output bytes, stderr,
exit status, producer mutation/finalization, checkpoints, queue ownership, and
copy/allocation/backing/slot bounds are unchanged. Adjacent oversized 24,577-byte,
zero/empty, borrowed-window, retained-byte-limit, and sink lifecycle cases are
unchanged. All 29 full-file test names match the baseline in order.

The test is admitted and had no path binding in the maintained integration
boundaries, lint inventory, or type inputs. Inspection of admitted active tests
and maintained scripts found no inbound reference making this test a sealed
input. This is a current ownership check, not a claim about historical artifacts.

## Negative-control preservation

An isolated child-process data-URL preload replaced positive suffix `subarray`
views with owned copies, simulating quadratic copying on repeated trimming.
The real head/tail command path still executed; no runtime source file was edited.
Both the original and reduced fixtures failed all eight cases specifically on
the copied-byte assertion, after their output/finalization checks passed.

| Fixture's first scale | Copied bytes | Unchanged bound: 2 × input bytes | Expected failures |
| --- | ---: | ---: | ---: |
| Original: 521 | 136,516 | 2,110 | 8/8 |
| Reduced: 37 | 754 | 174 | 8/8 |

The reduced smallest fixture exceeds the bound by 4.33× under the injected fault.
With the normal implementation, both post-change full runs pass all 29 tests,
with no skips, cancellations, or todos.

## Measurements

Serial full-file runs used `node --import tsx --test --test-reporter=tap` with
the test path. Values below are Node TAP durations, not external wall time.

| Scope | Before | After | After repeat |
| --- | ---: | ---: | ---: |
| Eight affected cases, summed | 33.169141291 s | 0.240747666 s | 0.240809667 s |
| Full file, 29 cases | 36.921857416 s | 2.317377958 s | 2.470412041 s |

The supplied broader profile measured the eight cases at about 12.4 seconds.
Host load differed: the larger local baseline reduction is not a CI savings
forecast. No full-workspace or CI runtime claim is made.

## Validation and handoff

- Targeted ESLint passed.
- Strict standalone TypeScript checking passed with NodeNext resolution,
  unchecked-index checking, and exact optional property types.
- Byte comparison confirmed that only the count array changed in the test and
  that production `src/commands/streams.ts` remained unchanged.
- All measurement and validation processes completed; no Git operations ran.
- Parent owns the separate commit and subsequent full-suite/CI measurement.
