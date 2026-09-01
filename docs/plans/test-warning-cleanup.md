# Test and runtime warning cleanup

## Scope

The normal guarded ESLint baseline reports 87 unused-binding warnings. Remove
unused imports and dead pure fixture declarations. Preserve awaited operations
whose side effects are asserted, and use the established ignored-binding naming
only where destructuring or iteration is required for behavior.

Remove the unused import in the opt-in native57 capture driver without running
it or changing its profiles, captured JSON, historical hashes, or old commits.
The captured snapshot continues to describe its original revision, not the
updated driver's source bytes. Do not change lint rules, exclusions, or receipts.

## Validation

Run focused affected suites and the ordinary guarded lint command. The root lint
test file passes all 253 tests after its unused import removal. Record the final
warning count and focused package results before delivering this improvement.

The affected package/regression selection passes 1498 tests across 50 files.
The cleanup removes 57 no-op/non-asserting tests and four unasserted stdin
probes while preserving all 1540 direct assertions and required state effects.
The trimmed subset falls from 3.05s to 2.36s with 228 retained tests passing.

The ordinary guarded ESLint run completes with exit 0, zero errors, and zero
warnings after these edits. No lint rules, exclusions, or receipts changed.
