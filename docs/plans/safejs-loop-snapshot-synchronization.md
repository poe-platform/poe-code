# Explicit loop snapshot synchronization

The dynamic-runtime candidate reproduced an existing loop snapshot test
failure in isolation: expected i=1, observed i=0. Instrumentation established
that the first dump captured loop-entry node 5 and the second captured await
node 26, with only one host wait call. The test's fixed 20-microtask flush no
longer reached that await before requesting the second dump. This was not
evidence of a lost mutation.

The test now explicitly observes the first await checkpoint and asserts its
source line and unchanged i/total bindings before requesting the next yield.
The next dump must still contain i=1, and all existing original and restored
execution assertions remain intact. No deadlines or workloads are changed.

The dynamic candidate passes all 31 run.snapshot tests. The same test-only
change is being checked against the committed-runtime validation checkout and
the maintained lint configuration before its separate commit and push.

Completed validation: all 31 tests pass against both the committed-runtime
checkout and the dynamic candidate; focused ESLint passes. The delivered test
retains the original mutation and replay assertions and adds first-await
checkpoint assertions. No production code is part of this change.
