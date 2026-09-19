# SQL streaming and transaction boundary user review

Use the actual Safe Bash Shell with MemoryFileSystem and explicitly injected
in-memory database bindings. No fixture files, native programs, network or real
databases are required by the canonical tests.

1. Run sql2csv and csvsql queries whose cursor yields one multiline row and then
   reports a late fetch error. Compare exact stdout, stderr and exit status;
   verify iterator return, result close, rollback and session close occur once.
   For csvsql use `-y 0` to avoid empty-stdin dialect sniffing in this profile.
2. Hold csvsql commit, cancel the caller and verify public execution stays pending
   until the admitted operation settles. A completed commit must not be undone;
   a rejected commit must be followed by rollback. Preserve caller reason identity.
3. Run sql2csv with the explicit MSSQL JavaScript transport, buffered execution
   (`--execution-option stream_results False`) and a request whose cancel throws.
   Cancel during its admitted query, verify no uncaught interruption exception,
   drain the query and verify rollback/release once and original caller reason.
4. Run the focused Node tests in
   `packages/safe-bash/tests/commands/csvkit-sql-stream-boundary-review.test.ts`
   after the maintained selected workspace build closure. Root owns the maintained
   aggregate integration/build/lint gates and exact discovery assertions.

Real PostgreSQL/MySQL/MariaDB/MSSQL/Oracle service runs remain separate optional
QA. These injected lifecycle checks do not establish real driver compatibility.
