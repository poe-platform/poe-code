# Identifier call replay bookkeeping

## Validated failure

The isolated dynamic-function candidate failed 15 of 20 genuine v6 Promise
compatibility tests. Saved and completed histories stalled after restoring;
the same source without a checkpoint completed. The identifier-call fast path
resolved the binding directly and skipped evaluateNode's beforeNode replay
boundary, execution checks, compilation scope and normal exception handling.

## Repair

Evaluate identifier callees through evaluateNode again. An optional reference
observer receives the already-resolved binding so a direct with-environment
call retains its receiver without evaluating getters or unscopables twice.
The observer is not forwarded to nested expression evaluation; sequence and
conditional calls remain indirect. Do not put receiver objects into completion
records, which also participate in snapshot serialization.

## Validation

The first repair restored all 74 focused v6/v7 history and with-binding tests.
The nine other previously failing suites passed 170 tests with one skip.
These runs used the initial completion-metadata implementation, subsequently
replaced by the reference observer after TypeScript exposed its incompatibility
with serialized completion types. The final observer passes 82 focused tests
across v6/v7 history, with calls and with snapshot recovery. TypeScript passed.
The final eleven-file rerun passed 208 tests with one skip but timed out in
one pending-input alias workflow; its isolated 19-test file then passed.
The full integration check remains required. Focused lint found no errors,
but reported one unused initializer variable in the separate parser followup;
that binding has been renamed to the configured ignored-variable form.
Additional native comparisons cover single getter/unscopables evaluation and
parenthesized direct versus sequence/conditional indirect calls.

Historical fixtures and deadlines remain unchanged. Full integration is still
required; no commit, push or release is claimed. Publication is held by the
user's instruction.
