# Bugfix 650: AWK concatenation work admission

## Root delivery validation

After isolating unfinished issue 649, the maintained selected virtual-bash build
passed; the combined focused regression selection passed 620/620 tests and the
maintained runner/inventory selection passed 279/279. Repository lint passed with
these unchanged product/test edits. Earlier combined full-suite failures concern
the isolated portable-entry integration; no passing full-suite gate is claimed.
The installed-package diagnostic screenshot was captured and visually inspected.

## Scope and validated defect

The September 8, 2026 writer window authorizes only the AWK runtime, a dedicated
regression file, and this plan. Root owns integration inventory, Git, lint, full
gates, delivery, and release. Shared options and README remain unchanged.

The current concat branch creates the combined byte string before checking its
buffer size, without charging byte-weighted execution steps. A 256-byte concat
succeeds with maxSteps 16, charging only six expression/statement steps. A
128-iteration accumulator charges 1,288 steps while ownership copies consume
8,256 bytes for one-byte appends or 66,048 bytes for eight-byte appends. These
were small, fresh MemoryFileSystem reproductions, not large CPU benchmarks.

## Implementation

1. Add failing regressions before changing the runtime.
2. Evaluate operands and convert them exactly once in the existing order.
3. Check cancellation and combined buffer capacity before concatenation.
4. Debit the combined byte length through the existing Budget.step before `+`.
5. Preserve byte strings, ownership, effects, formatting, and existing checkpoints;
   do not introduce ropes, options, or shared budget changes.

Internal text uses Latin-1 code units to represent bytes. Length already measures
the underlying UTF-8 or raw bytes; UTF-8 re-encoding would charge the wrong amount.
Check capacity before debiting work to preserve buffer-error precedence.

## Regression and verification plan

- Low-step single concat and bounded accumulators reject; rejected assignment
  does not reach its ownership copy, with an admitted observer control.
- Public Shell dispatch observes the same limit as direct command execution.
- Exact work boundaries cover empty, ASCII, UTF-8, and raw-byte operands.
- Exact buffer acceptance and one-byte-over refusal preserve UTF-8 and raw NUL.
- Both operand effects remain observable; later statements do not run on refusal.
- Right-operand CONVFMT mutation remains visible to subsequent conversions.
- Cancellation at byte-work admission preserves Error and null reason identity.

Use Node 22 from /tmp/kamilio-toolchain.path, TSX_DISABLE_CACHE=1,
TMPDIR=$(cat /tmp/kamilio-569-575-validation.path)/tmp, and unset NO_COLOR.
Run the dedicated file RED, then GREEN and focused maintained text-program tests.
No dangerous workloads, lint, Git, broad builds, or full suites.

## Evidence and handoff

Fresh execution on Node v22.22.0, with the environment above:

- RED, before the runtime patch: 16 tests, 6 passed, 10 failed, exit 1,
  271.43106 ms. Failures include an observed rejected-result ownership copy,
  unexpected success through Shell and both accumulators, missing byte charges,
  later-statement effects, and missing cancellation at byte-work admission.
- GREEN, identical dedicated file after the runtime patch: 16 passed, 0 failed,
  0 skipped, exit 0, 243.098085 ms.
- Adjacent maintained tests: 156 passed, 0 failed, 0 skipped, exit 0,
  3025.287898 ms across awk-format-work-budget.test.ts,
  awk-format-integration.test.ts, allocation-admission.test.ts, and
  awk-retention.test.ts.

The dedicated RED/GREEN command from the repository root was:

```sh
unset NO_COLOR
export PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH"
export TSX_DISABLE_CACHE=1
export TMPDIR="$(cat /tmp/kamilio-569-575-validation.path)/tmp"
node packages/safe-bash/scripts/test-reporting.mjs --import tsx --test-concurrency=1 packages/safe-bash/tests/commands/text-programs/awk-concat-work-budget.test.ts
```

Adjacent verification used the same maintained reporter command with the four
literal test paths listed above. Sandbox-isolated attempts exited before subtest
reporting; the reported RED/GREEN and adjacent results used approved escalation
for the root-designated external TMPDIR. No product change addressed that runner
restriction. All test files use in-memory fixtures; no large CPU workload ran.

Frozen owned paths:

- packages/safe-bash/src/commands/text-programs/awk-runtime.ts
- packages/safe-bash/tests/commands/text-programs/awk-concat-work-budget.test.ts
- docs/plans/bugfix-650-awk-concat-budget.md

Root must register the dedicated test in the integration inventory and run its
integrated build, type/lint checks, and gates. None of those broader checks, Git
operations, or delivery steps were performed here. Concat-heavy programs now
consume the existing work budget according to bytes, intentionally refusing
sooner. This bounds concat work, not every other possible AWK copy or host CPU
time; no rope redesign or broad runtime audit is claimed.

## September 8 strict-type follow-up

The maintained SafeBash typecheck during issue 657 integration reported TS2769
and TS7006 in this issue's cancellation witness: CommandDefinition.execute may
return synchronously, whereas assert.rejects requires a promise or async thunk.
The follow-up normalizes the result into a promise without changing cancellation identity,
output prohibitions or runtime implementation. The original failing typecheck is
retained in `/tmp/kamilio-657-final-gate.LSENd8/typecheck.log`.
All 16 focused runtime tests passed after the typing correction.
