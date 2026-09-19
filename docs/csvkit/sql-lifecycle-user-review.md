# Independent SQL lifecycle user review

Reviewed 2026-09-18 against the live uncommitted implementation. Added two
in-memory actual-Shell lifecycle cases in
`packages/safe-bash/tests/commands/csvkit-sql-lifecycle-user-review.test.ts`.

The pending-row case verified cancellation requests cooperative iterator return,
waits for its completion, preserves caller Error identity, then closes the result,
rolls back and closes the connection, without duplicate disposal effects.

The cleanup-failure case verified result-close failure remains observable as a
rejected Shell execution while rollback and connection-close still run. The first
test draft incorrectly expected a command diagnostic; it failed with Shell's
documented escaping cleanup AggregateError. Inspection confirmed the expected
host-failure contract, so the assertion was corrected without a product change.
This is an assertion correction, not a validated compatibility defect or fix.

Focused execution using Node's tsx test route with these two cases and existing
`csvkit-sql-provider-stress.test.ts` passed 24/24, with no skipped/cancelled cases.
No native oracle, filesystem creation, network or real database was used.
Root integration registered the new literal path. Subsequent maintained guard
checks passed 109/109; the complete 61-file CSV command cohort passed 1934 cases
with one skip and one explicitly unqualified TODO. Selected workspace builds,
ESLint and source/test/public-consumer typechecks passed. The final cohort and
limits are recorded in sql-adjacent-strings-user-validation.md.

No product bug was validated within this bounded review. Uncooperative host work,
external driver interoperability and the complete csvkit compatibility surface
remain outside this evidence.
