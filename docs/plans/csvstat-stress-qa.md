# csvstat independent stress QA

Use the frozen csvkit 2.2.0 / CPython 3.14.2 reference in `out/csvstat-reference`
only for research. Canonical regression tests use in-memory inputs and the actual
registered safe-bash csvkit engine; no native programs, host files, network or
real databases run inside those tests.

1. Measure exact stdout, stderr and status for raw count, blank/ragged records,
   empty count, names precedence, source-check conflicts, zero-based display,
   frequency ties/nulls/zero and negative limits, Decimal trailing-zero formatting,
   inapplicable operations, singleton stdev and empty CSV/JSON schema.
2. Add original regressions in `packages/safe-bash/tests/commands/csvstat-stress.test.ts`
   and run them before implementing fixes. Preserve red evidence as reported
   results; explicit unsupported status is a failure against measured parity.
3. Stress byte ownership with a producer reusing and mutating one byte buffer.
   Stress cancellation through an injected cooperative pending named reader;
   require execution to reject with the original abort reason and reader return
   exactly once before settlement.
4. After the author implements the command, rerun the focused maintained safe-bash
   test route uncached. Report production findings to the root integration owner,
   who owns production changes and public exports.
5. Inspect CLI screenshots through the repository screenshot route when the root
   wires the visible command. Root owns broader build/test/lint closure and any
   publication authorization. Treat unmeasured cases as open blockers.

Initial red run: 12 tests, 5 passing and 7 failing because metric execution returned
an explicit unsupported blocker. Raw count/names precedence and pending named-input
cancellation already passed. Eight further independently measured cases cover
serializer schema, Decimal frequency representation, Unicode text length and
Boolean/Date/TimeDelta applicability. These await the implementation rerun.

Implementation rerun: 23 tests, 21 passing and 2 failing. The newly reproduced
mixed naive/aware DateTime regressions showed `--unique` returning 1 instead of 2
and `--freq` combining equal wall times into one bucket. Python equality keeps
these values distinct. Root received exact red evidence before the production fix.
Two further safety checks passed: injected formatter failures propagate through
the registered command definition, and formatter-triggered caller cancellation
preserves a falsy original abort reason. Total independent stress cases: 25.

Final focused rerun after the root-owned DateTime frequency fix and rebuilt
workspace: all 25 tests passed, with no skips/todos, in approximately 0.68 seconds.
The regressions verify exact registered-engine stdout/stderr/status, byte ownership,
cooperative named-input cancellation, awaited sink backpressure, idempotent cleanup,
formatter error propagation and original abort-reason preservation. This result
covers the measured cases above; unmeasured command-suite cases remain blockers.

Additional bounded integration stress: all 28 tests passed, with no skips/todos.
A typed named-file CSV report piped through registered `csvcut` and redirected to
an in-memory destination produced exact expected bytes while preserving source
CRLF bytes. Typed `--sum` cancellation returned a cooperative pending named reader
before settlement. A Decimal admission limit returned explicit status 78, emitted
no statistic and finalized stdin exactly once. Focused ESLint for the test file
passed. No production changes were needed for these additional cases.
