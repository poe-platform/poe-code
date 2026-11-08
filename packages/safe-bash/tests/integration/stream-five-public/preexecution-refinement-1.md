# Read-only contract refinement before any execution

The first helper draft in preexecution-policies.md guessed seq's low-output
prefix as `310a`. This was not a planner expectation: C06 explicitly requires
already published output retained and recorded, without specifying write-call
segmentation. Inspection of accepted Session.output and seq code shows output
is chunk-atomic and may fail on the final LF, not the second number. Therefore
the helper now records every completed actual sink write and requires exact
retention of those bytes, a prefix of the original full expected output within
the limit. The original draft is retained; no execution result motivated this.

Likewise the diagnostic uses human-readable `input limit`/`output limit`, not
TypeScript property names maxInputBytes/maxOutputBytes. This follows the frozen
planner's command-prefixed limit-meaning rule, not diagnostic relaxation.

F08's harness middleware replaces stdin with a throwing iterator while retaining
the original default provenance; next() receives no arguments, per its contract.
This probe is test-only, not proposed middleware API functionality.
