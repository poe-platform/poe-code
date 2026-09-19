# Native SQL cancellation edge validation

A new in-memory regression reproduced a synchronous MSSQL request.cancel()
exception escaping its AbortSignal listener: `request already completed`.
Node can report such listener failures as uncaught exceptions. The native
adapter now contains the interruption exception, drains the admitted query and
preserves caller cancellation through the actual Shell resource scope.

The original regression failed before the product change and passes afterward.
Focused native adapter replay passes 13 cases. An independent agent added five
actual Shell cases for partial multiline CSV output on late fetch failures,
successful/rejected late commits during cancellation, and throwing MSSQL request
interruption. Root's final combined Shell replay passes 16 cases across the new
file and adjacent network/lifecycle tests. Rollback/release effects and caller
abort identity are asserted, not inferred from successful status alone.

Maintained csvkit lint (including product and test TypeScript checks), selected
safe-bash workspace build closure and focused new Shell test ESLint pass. Before
the focused adapter change, the maintained complete csvkit replay passed 4,065
tests in 83 files, with one skip and six TODOs; those seven cases remain explicit
gaps. The complete suite was not rerun after the localized change; the affected
native adapter regressions were rerun instead.

The maintained safe-bash typecheck also passes source/tests, historical and
source consumer checks, 26 current consumer groups and its expected negative
controls. Compile-only checks do not establish runtime or service qualification.

One root focused Shell invocation omitted the required `--import tsx` and failed
module resolution before tests ran. The corrected maintained reporting route
with that loader passes all 16 cases; no product change addressed that invocation
mistake.

This review does not qualify a real MSSQL service, external driver artifact,
DBAPI diagnostic codec or uncooperative cancellation. PostgreSQL, MySQL,
MariaDB, MSSQL and Oracle live-service QA remain unmeasured without configured
services. Prior broad npm-test timeout blockers remain unresolved. No README
content, staging, commits, pushes or publication were changed by this review.
