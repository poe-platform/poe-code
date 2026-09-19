# sql2csv independent Safe Bash stress validation

Date: 2026-09-18. A worker distinct from the implementation owner inspected
`packages/csvkit/src/commands/sql2csv.ts`, its query operation, database contracts,
Runtime writer/input behavior and maintained Safe Bash lifecycle tests.

Added `packages/safe-bash/tests/commands/sql2csv-stress.test.ts`: 15 actual-Shell
cases with explicit in-memory database bindings and the maintained memory VFS.
No host files, subprocesses, native programs, network, LLMs or real databases
are accessed by these tests. Query-file setup and verification remain in memory.

Measured exact output channels/status and invocation/resource effects for all
four header/line-number combinations with duplicate/empty labels; query precedence
over a missing FILE and supplied stdin; last repeated option wins; default
`sqlite://` and execution settings; full-file universal newlines and unsplit SQL;
non-row output and iterator exclusion; driver bytes/null/bool/large integers;
connect-before-missing-file failure; and six omitted ordinary-CSV flags. Frozen
`oracle-3.14.2.json` supplies executable usage bytes for rejected flags.

The first seven new cases passed immediately. Expanding to 15 produced one
test-author error: the binary-cell expectation omitted CSV quoting of a Python
bytes representation containing double quotes. Corrected that expectation to
the CSV writer contract; this was not a validated product defect and no product
source change was made. All 15 new cases subsequently passed.

Focused uncached execution:

```sh
node --import tsx --test packages/safe-bash/tests/commands/sql2csv-stress.test.ts packages/safe-bash/tests/commands/csvkit-sql-lifecycle-user-review.test.ts
```

Result: 17 passed, 0 failed, 0 skipped, 0 cancelled. The two existing lifecycle
cases verify cooperative cancellation settlement waits for row return, and result
cleanup failure still rolls back/closes the session. No validated implementation
defect was found in this cohort.

Limits: this is injected-provider behavior, not a new differential capture against
the frozen CPython/SQLAlchemy/driver environment. Real SQLite DML persistence,
AUTOCOMMIT, external drivers, locale profiles, unsupported encodings, product
visual checks, build/lint and broad integration gates were not measured by this
worker; their absence is not a pass. Root owns maintained test registration and
the final integration checks. No commits, pushes, publication or README edits.

## First-statement AUTOCOMMIT independent follow-up

Root subsequently qualified first-statement execution isolation `AUTOCOMMIT`
against native persisted DML effects and added provider support. This worker
read that implementation without modifying it and added
`packages/csvkit/src/sql2csv-autocommit-stress.test.ts` with eight actual SQLite
WASM/memfs cases. The installed WASM module is read, but no host file is created
and database effects remain entirely within memfs.

Five unqualified isolation values (`SERIALIZABLE`, `READ UNCOMMITTED`, lowercase
`autocommit`, null and zero) throw exact `CsvkitBlocked` with status 78 and create
no table. These are successful blocker assertions, not supported isolation
claims. Changing isolation after a prior SELECT blocks before INSERT. Explicit
BEGIN under first-statement AUTOCOMMIT rolls back its INSERT. A UNIQUE failure
after an autocommitted INSERT preserves that earlier persisted row after rollback,
close and reopen; repeated close remains harmless. An additional actual-Shell
test verifies isolation forwarding without introducing explicit commit.

The first run exposed a test-author expectation error in all five blocker
assertions: expected messages omitted the standard unsupported/unqualified prefix.
Corrected the expectations after inspecting `CsvkitBlocked`; no product change.

Focused uncached follow-up execution:

```sh
npx vitest run packages/csvkit/src/sql2csv-autocommit-stress.test.ts packages/csvkit/src/sql2csv-sqlite.test.ts
node --import tsx --test packages/safe-bash/tests/commands/sql2csv-stress.test.ts packages/safe-bash/tests/commands/csvkit-sql-lifecycle-user-review.test.ts
```

Results: SQLite cohort 10/10 (8 independent cases plus 2 root native-effect
fixtures); actual-Shell/lifecycle cohort 18/18 (16 stress plus 2 lifecycle).
No skipped cases, no validated provider defect. This worker did not execute
native csvkit, so independent native differential qualification remains root's
evidence. First-statement AUTOCOMMIT does not establish other isolation levels,
changing transaction configuration after autobegin, external-driver behavior or
unmeasured interactive/locale profiles.

`npm run lint --workspace=@poe-code/csvkit` completed ESLint and source typecheck,
then failed test typecheck at root-owned `src/sql2csv.test.ts:51:92` (TS2532,
possibly undefined). Reported to root without modifying its file. That invocation
is not a passing lint gate; root owns the repair and rerun.
