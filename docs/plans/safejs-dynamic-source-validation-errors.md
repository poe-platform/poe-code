# Dynamic source snapshot validation errors

A malformed saved dynamic function body (`return (`) was rejected through
both public run-snapshot restore and interpreter-snapshot restore as an
unwrapped SyntaxError. The existing mutation test asserted only that an error
was thrown. Strengthening it to require SnapshotValidationError and adding a
public restore regression produced two failures and five passes.

Both restore validation paths now convert only dynamic-source SyntaxError to
SnapshotValidationError with invalidValue and the offending heap record path.
Other errors, including fatal compilation-budget errors, propagate unchanged.
No malformed source is accepted and no compiler limits are relaxed.

All 35 focused restore/source/AST tests, package TypeScript and initial focused
lint passed. Two added regressions force a 1,000-step budget failure during
dynamic-source parsing through both restore APIs. The nine-test source suite
and TypeScript passed; the assertions were then strengthened to inspect the
budget error's code, budget and limit; the final nine-test rerun passed. Lint
for the expanded test file is running. The changes
are local and not part of the frozen full-validation checkout. Releases and
pushes remain on hold.

The nine-test budget/source suite's focused lint subsequently passed. A new
public-restore probe then found that unreferenced guest-source records bypassed
source parsing entirely when no closures existed. Malformed body and parameter
regressions both failed; the valid unreferenced-source control passed (two
failures, ten passes). Source parsing now occurs for all guest-source records,
outside the conditional closure AST checks. All 40 expanded restore tests and
package TypeScript and focused lint passed. This is additional local work, not covered by the frozen
candidate's completed lint or ongoing root tests.
