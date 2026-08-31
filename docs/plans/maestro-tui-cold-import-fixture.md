# Maestro TUI cold-import fixture repair

Date: August 31, 2026

## Release blocker and scope

Release run `33376582506` for confinement commit
`4567ca82c1b37e3297c77a7c2b1b2ca989d26c9a` failed in the Maestro TUI
workspace during `npm test -- --concurrency=4`. Schema run `33376582471`
succeeded. The release stopped before smoke and publishing.

The approved follow-up changes only `packages/maestro-tui/src/run.test.ts`
and this record. It does not change production, hooks, workflow concurrency,
the five-second test deadline, exclusions, assertions, action wiring, or the
separately qualified confinement implementation.

## Causal reproduction

The unchanged nine-case file passes with an ordinary fresh process and no
cache. Its first timed test includes the genuine cold `run.js` import; that
import is cached for later cases. The fixture never resets module identity.
Its partial mocks still load actual dependency barrels and replace only the
existing boundary functions.

A private diagnostic Vite transform hook delayed only this exact module's
unchanged source by 10.1 seconds. It returned no replacement code and used
the maintained aliases, setup, pool, worker count, mocks, and all nine cases.
This reproduced the three CI failure IDs exactly: the first two tests time
out at five seconds, then `defaults action variables to process.env` sees
zero editor calls. The latter is unfinished-test spillover after subsequent
`beforeEach` mock resets, not evidence to change the action assertion.
The zero-delay control passed 9/9. The delayed baseline was 6 passed / 3 failed
with ordinary exit 1 and no survivors. CI's reported 10.03-second transform
work is consistent with this mechanism; the injected delay is a controlled
reproduction, not a claim to have profiled the remote runner's every import.

## Minimal repair

Load `runMaestroTui` once through a static import after the existing imports.
Vitest retains the hoisted mocks; the same real module is collected before
the timed test bodies. Remove only the nine redundant dynamic-import
declarations. Keep every mock factory and per-test reset, all task-list and
workflow inputs, and the actual explorer/action behavior unchanged.

## Qualification

Require the same controlled delayed import to pass all nine cases, plus
repeated fresh-process ordinary workspace tests with cache disabled. Compare
AST-normalized test bodies after removing only the approved import setup;
assertions, IDs, mock factories and reset logic must remain identical.
Run formatting, strict types and ordinary root commit/push hooks. No separate
confinement artifact rerun is needed before the fixture-only commit unless
production/package bytes change. CI must then complete before an actual
registry tarball is installed and independently verified; this record does
not claim a published release.

### Matched results

The same 10.1-second delayed import passes 9/9 on Node 18.18.2, 22.22.2,
and 24.14.0 with normal exit. AST comparison preserves all nine case IDs,
22 expectations, four mock factories and the complete `beforeEach` reset.

Fresh ordinary workspace runs with `--no-cache` pass 28/28: three Node 22
repeats and one each on Node 18 and 24. Vitest reports 1.34–2.00 seconds
overall and 9–12 milliseconds for the complete nine-case run fixture.
The unchanged five-second per-test deadline remains in force. Formatting
and the root `lint:types` command pass. No production or package bytes
change; the prior confinement artifact results therefore remain applicable.

Normal commit/push hooks and the subsequent release workflow are still
required. These local results do not establish publication or erase the
original CI failure and controlled red reproduction.
