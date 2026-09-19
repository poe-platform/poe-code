# SQLite failure and command edge validation

Procedure: docs/plans/csvkit-sqlite-failure-user-qa.md. This is a bounded additional review, not completion of csvkit or arbitrary-query parity.

Four original in-memory regressions failed before the corresponding product fixes:

- Calling connect immediately after dispose admitted a connection before the cleanup microtask. Disposal now closes admission synchronously.
- An injected revoked read authorization became SQLITE_IOERR_READ instead of the exact CsvkitBlocked object. The VFS read callback now retains the named failure.
- An injected lock denial leaked a database during connection setup; provider disposal failed because the VFS still had open files. Lock failures are retained and partially initialized databases are closed before rejection.
- A commit-time injected sync denial became SQLITE_IOERR_FSYNC. Transaction-control execution now preserves named host failures and cancellation/work refusal. The regression restores sync authority, rolls back, verifies the rejected row is absent, and successfully commits another row.

The final focused SQLite tests pass 44 assertions. These new lifecycle/authorization assertions are not reference SQL parity measurements; no fresh native reference capture was collected.

A different agent authored packages/safe-bash/tests/commands/csvkit-execution-user-edge.test.ts. Nineteen frozen io-reference cases run through actual Shell with reusable one-byte stdin fragments and empty chunks; each compares exact stdout/stderr/status and unchanged input-file content/inventory. Two of those cases exercise explicit status-78 blockers rather than original reference parity. Its twentieth test seeds a committed memfs database, revokes injected reads, compares exact status78/diagnostic, verifies every acquired file is closed and database bytes are unchanged, then restores authority and successfully reopens the table. Root registered its exact discovery path in the maintained inventory assertion. The independent agent's focused ESLint check passed.

Final maintained domain unit execution: 70 files, 3,854 passing tests, one skipped test and six TODOs. Focused actual-Shell CSV command execution: 1,910 passing tests, one skip and one TODO across 1,912 cases. Neither skips nor TODOs are passes; safety refusals are not compatible native successes. Domain ESLint and product/test typechecks pass. Selected maintained domain and safe-bash build closures pass (two and ten workspace builds). The maintained default-runner discovery/inventory regression passes, including the newly registered file. These are focused routes, not a full repository test/lint acceptance.

An ad hoc screenshot of the compiled public Shell/plugin was generated and viewed. The recursive CTE/aggregate emits total=6 with status0; injected revoked read authority emits the complete named diagnostic and status78. Headers, result and diagnostic are readable without clipping. Owned screenshot, smoke source and temporary logs are purged after recording results.

The maintained safe-bash source/test and public-consumer typecheck route passes all 26 current consumer groups and its three expected negative controls. Its reported status is typecheck-passed-not-runtime-acceptance: compilation does not establish engine/runtime parity. Git diff whitespace validation passes; the existing staging is untouched.

The SQLite engine/build/driver blockers in docs/specs/csvkit-sqlite.md remain explicit: UTF-16/encoding, missing FTS3/FTS4/Geopoly and Python functions, incomplete PRAGMA/driver diagnostic profiles, unbound filesystem/URI/extension features, hard aggregate WASM accounting, same-thread asynchronous preemption, arbitrary-query coverage and durable VFS qualification. The concrete memfs adapter proves only in-process persistence/locks, not host/crash atomicity. Other suite blockers remain in implementation-status.md. Unrelated edits/staging and README content are preserved. No commit, push or publication occurred.
