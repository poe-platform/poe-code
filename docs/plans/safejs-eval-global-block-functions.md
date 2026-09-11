# Global eval block-function assignment

Six native comparisons reproduce five failures: assigning eligible legacy block
functions to non-writable global data properties throws instead of being ignored;
setter properties are rejected without invocation; getter-only properties throw.
The unexecuted-block control correctly performs no setter call.

Global variable-environment assignment now accepts the guest property-write
operation and propagates its asynchronous completion. The declaration evaluator
awaits an actual pending assignment only. Local variable assignments remain
synchronous and still bypass intervening with-object environments. Property
writes use non-throwing assignment failure semantics while preserving thrown
setter exceptions and inherited descriptor checks.

The first implementation supplied false to checkInherited rather than the
separate throwOnFailure argument; all five failures remained. This was corrected
without changing assertions. The five-file global/declaration/scope/block-recovery
selection then passed all 74 tests.

An additional recovery case sends an eval function through a global setter,
retains it across a checkpoint and verifies its mutable eval-local capture.
The additional four-file recovery/function selection passes all 71 tests.
TypeScript, focused lint and whitespace checks pass.

This remains part of the uncommitted eval implementation. Non-extensible global
Annex B behavior and other documented eval gaps still need validation. No push,
release or broad conformance claim.
