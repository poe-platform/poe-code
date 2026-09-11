# Issue #596: bounded regex match-range replies

## Validated baseline

Baseline: `c657333d005e4e4243df9ae3889a88b3ee91346a`, September 4, 2026.
All witnesses are bounded and memory-only. The reported multi-second runtime,
259 MB heap growth and worker OOM are not adopted as reproduced evidence.

- The actual grep compiler accepts 100,001 candidate ranges from 100,001 matching
  bytes; the rg compiler rejects the equivalent row at its existing 100,000 cap.
- Grep also accepts 100,001 candidates across two patterns, or from an empty
  pattern on 100,000 bytes. Exact 100,000 succeeds. Non-all matching returns one
  result; a rejected word boundary produces no result.
- Public `createStandardCommands()` through the actual Node worker accepts those
  overflow cases with `grep -oc`: status zero and only `1\n` output. This isolates
  candidate-range retention from large printed output.
- Current `protocol.ts` accepts 100,001 ranges in one reply row and 100,002 across
  two rows. The supported injected-worker executor also accepts the first case.
- A malformed later row is rejected after a prior row's Match object is copied.
  Falsey pre-abort reasons retain their identity with no copying; worker cleanup
  controls finish without listeners.
- Bounded execution of the worker body with actual matching and an instrumented
  port/vector constructor constructs two 50,001-range vectors, 100,002 ranges in
  total. This is not an actual-thread resource-usage measurement.

An independent existing inconsistency remains out of scope: two duplicate grep
patterns can produce more candidates than the protocol's existing input-derived
bound, even for a small row. Do not loosen that bound or alter duplicate/overlap
semantics as part of #596.

## Selected policy

Use fixed internal ceilings of 100,000 raw candidate ranges per row and 100,000
per reply. Count accepted duplicates, overlaps and empty matches before output
suppression. Do not truncate or add public tuning options. See the accepted
contract in `packages/safe-bash/src/contracts/regex-range-admission.md`.

Normal command batches target 128 rows / 64 KiB, with oversized single lines
yielded separately. They fit the reply ceiling under the existing input-derived
range bound. Arbitrary direct-executor batches above 100,000 total ranges are an
intentional compatibility narrowing, demonstrated by the two-row witness.

Grep admits each candidate before range creation/push. Worker serialization
admits cumulative ranges before allocating the next typed reply vector. A single
provisional row remains independently bounded; no new matcher argument is needed.
Consumer validation preflights all row shapes/counts before reconstructing Match
objects. Received transport buffers and other memory domains remain outside this
counting guarantee.

## Ownership and verification

- Producer owner: `matching.ts`, `range-admission.test.ts`, exact literal test
  registrations for all three new tests.
- Protocol owner: `protocol.ts`, shared internal limit declarations, and
  `reply-admission.test.ts`.
- Worker owner: `worker.ts` and `worker-range-admission.test.ts`, including actual
  Node-worker/public-factory checks. The initial built worker is the baseline;
  root performs the normal build before final worker GREEN acceptance.
- Root: plan/contract, public integration, final independent review, normal
  build, current consumer checks, guarded lint, exact-path commits and delivery.

Preserve the user-staged text-command/helper files and all held evidence. Run
focused tests first. Do not overlap build activity with guarded lint. No README,
workflow unit test, physical RSS claim or visual CLI redesign is part of this fix.

## Delivery

Implementation and local validation are complete in local commit
`f44109a8d0267a5cd6af794557e99dbe899c7532`. Remote delivery and publication are
not established by that local commit. Close #596 after verified remote-main
delivery, then monitor actual releases while progressing to the next issue.

## Candidate evidence

- Producer TDD: initial 12 passed / 7 failed; an additional rg pre-push witness
  failed after observing 100,001 pushes. Final source checks passed 20/20.
- Protocol TDD: initial 6 passed / 10 failed; final new tests passed 16/16.
  Existing provider controls passed 4/4 and the selected executor reply-validation
  control passed 1/1 without creating workers.
- Actual baseline worker/public TDD: 4 passed / 3 failed. Excess single-row,
  multi-row and public count-only grep requests were accepted incorrectly.
  Exact caps, borrowed input, non-all/empty and expr controls passed. The modified
  worker's final GREEN remains pending the normal root rebuild.
- Two maintained discovery/type-accounting controls passed; all three new tests
  are registered literally. This is not a compiler or full-unit-suite claim.

First-candidate root gates passed: 36/36 source tests, normal build, and current
consumers (historical build-first, three source groups, 26 current groups and
three expected negatives). Logs are `/tmp/poe-596-source-tests.log`,
`/tmp/poe-596-build.log` and `/tmp/poe-596-consumers.log`. Actual rebuilt worker
checks passed 7/7, and the maintained executor/command/pattern-admission cohort
passed 69/69 with all 17 workers closed and no owned listeners.

Those gates are not final acceptance: independent review found a second concrete
admission bypass. A genuine worker sent a length-tracking Float64Array backed by
a growable SharedArrayBuffer, initially 100,000 ranges, then grew it by one range
while consumer copying ran. The supported injected-provider executor returned
100,001 ranges on the bounded witness. No custom getters or prototype changes
were used. The built-in worker emits nonshared buffers and does not trigger it.

The selected correction preserves valid stable shared replies: bind copying to
the admitted lengths and reject observed length drift, rather than banning all
shared buffers. It does not promise an atomic snapshot of mutable payload values.
The deterministic actual-worker regression first passed its stable-buffer control
and failed its growing-buffer case. The correction passes all 19 reply-admission
tests and four provider controls. It copies exactly the 100,000 admitted matches
before rejecting observed growth to 100,001 through `PROTOCOL`. A bounded Atomics
barrier at an instrumented cancellation checkpoint schedules the genuine worker
mutation; this is scheduling instrumentation, not a wall-clock race or resource
measurement. All instrumentation is restored and workers/listeners retire.

Independent review of the frozen correction found no actionable findings. Tiny
shared-buffer controls exercised drift before, during and after copying, stable
storage, and simultaneous drift/cancellation with each falsey reason. Copying
never exceeded the admitted count; cancellation retained exact reason identity.
Root's combined final producer/protocol run passed 39/39 with no skips or
cancellations (`/tmp/poe-596-source-tests-final.log`). Final normal root build
passed (`/tmp/poe-596-build-final.log`). Rebuilt actual-worker/provider checks
passed 11/11 (`/tmp/poe-596-worker-tests-final.log`). Independent rerun of the
adjacent maintained cohort passed 69/69; all 17 workers were closed before safety
cleanup and no owned listeners remained. Four built public-export checks across
`virtual-bash` and `poe-code/safe-bash` confirmed exact-limit status zero with
`1\n`, and overflow status two with no stdout and the range-limit diagnostic.

Final current-consumer checks passed: historical build-first, three source
groups, 26 current groups and three expected-negative groups
(`/tmp/poe-596-consumers-final.log`, report directory
`/tmp/poe-596-consumers-final-report`). The contract checker passed without
warnings. Maintained root `npm run lint` passed: 9,686 linted files, zero errors
or warnings, followed by root type checks and workflow lint
(`/tmp/poe-596-lint-final.log`). Build activity did not overlap guarded lint.
Final source/test hashes match the reviewed freezes, `git diff --check` passed,
and the three user-staged files remain unchanged at 33 insertions / 3 deletions.
These focused gates do not claim a full root unit run, screenshots, heap
measurements or live-service QA.
