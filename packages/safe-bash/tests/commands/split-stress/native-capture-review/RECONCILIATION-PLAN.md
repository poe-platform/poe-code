# Preserve the first evaluator failure; qualify relocation exactly

Frozen input commit: f2fb2155365ec1c175b0891feec6ec4d2164f1ea.
freeze.json SHA256: 0184acf695ec0203011ef4ca65e33bb4ccf8558e0b872ffa483bc392d5556520.
results.json SHA256: 5f7c500dfb9473cc6ef50b6279ba187dab8146883e8ad9ef9e1c7ef6e9aa8b6a.

All five subprocess executions completed before the original evaluator failed:
canonical 4/4 in each mode, deliberate reporting negatives 3 failures/1 pass in
each mode, and independent real-fs guards 23/23. Original evaluator expected only
the GNU profile executable field to change after moving the candidate. Actual
GNU9.7 also includes its argv[0] absolute path in the native two-modes help hint.
This is a verifier expectation defect, not a repaired-test failure. Original
PLAN.md, review.mjs, failure result and raw logs are retained unchanged.

Freeze this additional evaluator before running it. No native rerun or product
mutation. Re-read the existing reports; allow exactly these two fields only:
gnu9.7-darwin profile.executable, and gnu-errors report[id=two-modes].expected.stderr.
For the latter, require the entire known diagnostic with the exact copied GNU
executable; substitute that path with the exact historical executable. All other
fields and final serialized bytes must remain equal. Record both raw hashes and
the normalized equality, not an unqualified byte-identical claim.

Finish all checks that the early evaluator exception prevented: negative failure
payloads, retained scratches, four reports/mode, distinct paths, modes, default
no-report writes and process liveness. Authenticate assertions via TypeScript AST:
all assertion callee/first two arguments unchanged; only two final failure-message
arguments differ. Preserve native declarations/scenarios/profile-difference
vectors. Compare current copy/live/native hashes/modes with the original freeze,
including re-enumerated split/frozen trees (new entries detected). No other owner
files or historical evidence are modified.
