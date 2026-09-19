# Csvkit input lifecycle user review

## Procedure

1. Execute `csvcut` through the actual safe-bash `Shell` with a borrowed stdin
   iterator whose pending read cooperates with return, while return itself waits
   on a separately controlled promise. Cancel the caller, inspect settlement,
   then release return and dispose. Assert exactly one acquisition and return.
2. Repeat with an explicitly injected named-file streaming provider, forbid bulk
   reads and stdin acquisition, and require registered named cleanup to finish
   before caller cancellation settles.
3. Supply a named source containing `a\nx\n`, followed by EOF, whose return
   rejects. Assert exact retained output, unsuccessful status and diagnostic,
   and exactly one return including disposal.
4. Run adjacent retained-byte and SQL cleanup boundary tests alongside these
   cases. Root integration owner registers the new literal test path and runs
   maintained workspace build/typecheck/lint checks.

Canonical in-memory implementation:
`packages/safe-bash/tests/commands/csvkit-input-lifecycle-user-review.test.ts`.
Record observations in
[the validation report](../csvkit/sdk-capability-user-review-validation.md),
keeping this document limited to the QA procedure.
