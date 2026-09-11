# Deterministic split cancellation clocks

The full unit run failed one split cancellation assertion: 757 steps occurred
before cancellation, while the test expected exactly 1024. `Budget.tick`
intentionally yields at either 1024 steps or 25 elapsed milliseconds. The test
left the clock uncontrolled, so valid elapsed-time cancellation could fail it.

Keep product code and yield thresholds unchanged. Use the maintained
`context.mock.method(performance, "now", ...)` pattern from the jq control-flow
tests. The existing test receives a constant clock and keeps its exact 1024-step
assertion. Separate false/null cases receive readings `0, 0, 24, 25`: construction,
initial tick, first scanning tick, and second scanning tick. They require exactly
five step calls, four clock reads, one checkpoint, no value validation, and the
original cancellation reason.

Deterministic RED: applying the advancing clock to the original assertion fails
both false/null cases with `5 !== 1024`, independently of host scheduling.
Evidence: `/tmp/poe-split-clock-red.log` (31 passed, two failed).

GREEN: the complete string-work and jq-control-flow-limits files passed all 113
tests, with zero failures, cancellations or skips, in 2.27 seconds. The maintained
command was `node scripts/test-reporting.mjs --import tsx --test-concurrency=1
tests/commands/structured/string-work.test.ts
tests/commands/jq-control-flow-limits.test.ts`, run from `packages/safe-bash`.
Evidence: `/tmp/poe-split-clock-green.log`. `git diff --check` also passed.
