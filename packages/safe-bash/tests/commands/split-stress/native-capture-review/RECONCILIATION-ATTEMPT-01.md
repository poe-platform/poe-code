# Static evaluator failure retained

The first read-only reconciliation invocation stopped at reconcile.mjs:61 before
report comparison, with ERR_ASSERTION comparing the `profiles` declaration:
candidate adds `as const` to the original array. All array element values are
unchanged. The complete original and candidate declarations are preserved by
candidate.diff, the immutable Git inputs and the tool error; no data was modified.
The original evaluator implementation is committed in 8ccb8d3f.

This is a second verifier expectation defect, not a candidate regression. Correct
the static comparator to retain raw declarations and compare the initializer's
runtime expression after stripping exactly the added profiles `as const` type
assertion. Do not strip or change any profile element, hash, vector or assertion.
Commit this refinement before the next read-only evaluation. No tests rerun.
