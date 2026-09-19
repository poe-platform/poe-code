# csvsql independent stress QA

Use an independent agent to run the actual Safe Bash shell against injected in-memory database providers and virtual CSV inputs. Do not spawn native utilities, create host files, contact networks or use real databases in canonical tests.

1. Confirm database connect and transaction begin occur before CSV content consumption. With `--no-create --insert`, verify insertion occurs without CREATE TABLE.
2. Verify naive SQL delimiter splitting inside SQL string literals, repeated query ordering and skipped blank query segments.
3. Verify the final executed query alone determines CSV output. A final statement without rows suppresses earlier results. Check BOM and writer line numbers.
4. Verify every acquired query result closes once, transaction commits after success and session closes once.
5. Verify hook splitting executes empty segments, hook failure prevents commit, rollback happens once and session closes once.
6. Verify query-file precedence and unchanged virtual input files; hook execution once per nonempty table; basename extension handling; query-without-db enables insertion into injected in-memory SQLite.
7. Cancel while result iteration has a pending cooperative `next()`. Verify iterator `return()` releases it before result/session disposal, original cancellation propagates and commit never occurs.
8. Trigger an exact CSV field-size failure after transaction begin. Verify no SQL executes and rollback precedes session disposal.
9. Cancel separately while `begin`, `commit` and `hasTable` are pending. Verify rollback/disposal wait for each admitted method to settle. When commit succeeds despite cancellation, verify disposal occurs without rollback.
10. Combine overwrite and create-if-not-exists with table reflection sequences `[true, false]` and `[true, true]`. Verify DROP precedes the second probe; CREATE occurs only when the second probe reports absence; insertion occurs in both cases.
11. With MySQL metadata, no-create and no-constraints, verify CREATE TABLE length compilation is skipped and the unqualified insert driver remains an explicit blocker.
12. Request a unique constraint containing a missing column with create-if-not-exists. Verify metadata validation fails before reflection, even when the existing table would skip CREATE.
13. Use an empty table name and a negative chunk size yielding zero batches. Verify unused INSERT identifiers are not compiled, after-insert hooks still execute and the transaction commits.

Canonical regression: `packages/safe-bash/tests/commands/csvsql-stress.test.ts`. Initially reproduces the existing database-execution blocker. Root owns integration and maintained build/test/lint verification.

Independent agent verification on 2026-09-18: `node --import tsx --test packages/safe-bash/tests/commands/csvsql-stress.test.ts` passes all eighteen cases against the workspace build. The three pending driver-method regressions first failed because session disposal raced method settlement; admitting those methods into the registered resource scope fixes the observed race. The combined overwrite/create-if-not-exists regressions failed because reflection was shared across DROP and CREATE; these operations now reflect independently. The no-create MySQL regression failed because skipped DDL was compiled; compilation now happens only when CREATE executes. The existing-table missing unique-column regression returned success; metadata validation now runs before reflection. The zero-batch empty table-name regression failed because an unused identifier was compiled; INSERT compilation now happens only for executed batches, and DROP identifiers compile only when DROP executes. Rebuilt with `npm run build:workspaces -- --workspace=@poe-code/csvkit`. These assertions qualify injected SQLite execution and cooperative result cleanup; real database drivers, default empty-input sniff warnings and host-service guarantees are unmeasured by this suite.
