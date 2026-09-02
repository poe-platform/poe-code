# Exercise deferred trace counting without a real wait

## Finding

The full 39-phase Vitest profile at `962594888` spends 1003ms in the deferred
trace-counting test. Production deliberately waits one second before counting;
the unit test currently waits that second too. Its cache assertion also records
the tokenizer-call count after the second load, making the equality vacuous.

## Change

Use test-local fake timeout timers, restoring them after the test. Assert that
loading returns an estimate after its legitimate tokenizer sample, advance the
existing timer, and await the real callback and memfs cache write. Assert the
separate exact-counting call and capture the call count before the next load so
the existing cache claim becomes meaningful. Keep the production delay, cache
implementation, file identity and callbacks unchanged.

## Qualification

In the isolated probe, bypassing non-deferred cache hits still passes the old
test, taking 1.01 seconds. The strengthened assertion rejects the same mutation:
the second load makes three tokenizer calls instead of the expected two. Restore
the production loader byte-for-byte before final validation. An initial test
draft incorrectly expected no estimator sample; the final test explicitly
retains that sample rather than changing production behavior.

All 79 package tests in eight files pass. All 20 index-file tests also pass;
the deferred-counting case takes approximately 4ms rather than the profile's
1003ms. This removes a real one-second wait through virtual time, not a lower
production delay or a full-suite benchmark claim. The focused validation shares
the host with a normal commit lint run; worker settings remain unchanged.
Evidence is retained in `/tmp/poe-trace-cache-*.log` and the index JSON report.

Scoped strict type checking also exposes two fixture errors in this file: a
mock widens a trace-source literal to string, and a no-children fixture omits
required TraceView fields. Type the discover mock against TraceReader and
provide a complete view fixture. The same scoped type check then passes; no
production API or compiler diagnostic is weakened.

No test, assertion or permanent coverage selection is removed. Use normal
commit/push gates and monitor publication after integration.
