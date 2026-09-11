# Tail-position call resource audit

## Verified behavior

A strict guest accumulator returns the correct sums but consumes call-depth
budget linearly: input 0, 20 and 40 produces peak depths 1, 21 and 41; the
current depth returns to zero afterward (021335). At maxCallDepth 8, input 20
rejects with budgetExceeded/callDepth, current 9, limit 8; at 128 it returns 210
(6af940).

This is an established sandbox budget contract, not evidence to disable the
guard. `interpreter.test.ts` explicitly requires recursive arrows to exceed
maxCallDepth 3, and README defines the option as nested interpreter calls.
`Budget.enterDepth` increments and releases that accounting for calls.

## Completeness distinction

The [tail-position call specification](https://tc39.es/ecma262/2024/multipage/ecmascript-language-functions-and-classes.html#sec-tail-position-calls)
requires eligible strict calls to release or reuse transient execution-context
resources. The budget measurements alone do not establish physical activation
retention or prove constant-resource tail execution. Native Node stack overflow
is not a qualified conformance oracle for proper tail calls.

Audit the actual guest invocation/return path and retained scopes separately.
Any tail-dispatch improvement must preserve explicit resource guards and fatal
budget behavior, while measuring whether transient contexts are released.
Tail-position eligibility must account for pending finally/disposal work,
conditional/logical returns, method receivers, and non-eligible async/generator
calls. Checkpoint/replay and error-source diagnostics need dedicated coverage.
Do not count the successful small accumulator as full tail-call conformance.

No runtime changes were made by this audit. Full package run 52427 remains
active at runtime 8cab804a9; no push or release during the release hold.
