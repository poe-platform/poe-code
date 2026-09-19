# csvsql user stress QA

Run the literal `csvsql` command through the actual safe-bash Shell registry with
in-memory CSV/query files and an explicitly injected database session. The
canonical procedure is implemented in
`packages/safe-bash/tests/commands/csvsql-user-stress.test.ts`.

1. Abort while connection acquisition is pending. Release acquisition and verify
   rollback/disposal occur once, without beginning or committing the transaction.
2. Abort while query or executemany work is pending. Verify rollback/disposal wait
   for admitted work, then close its late result before closing the session.
3. Use an existing directory as a query argument. Verify exact file-open error,
   failure status, rollback and disposal; no literal query may execute.
4. Supply flags absent from csvsql's inherited parser: `-n`, `--names`,
   `--no-sniff`, `--out-delimiter`, and `--columns`. Verify parser failure before
   connecting to the database.
5. Repeat an engine option key and supply nested Python literal arguments.
   Verify the last key wins, booleans/numbers retain their values, and no output
   or diagnostics appear on success.
6. Load two named tables with repeated INSERT prefixes and a custom SQL
   delimiter. Verify hook order independently for each table, trailing empty
   hook execution, exact bound INSERT values, and one transaction commit.

Focused command:

```sh
node --import tsx --test packages/safe-bash/tests/commands/csvsql-user-stress.test.ts
```

Result on 2026-09-18: 11 passed, zero failed/skipped/TODO; no product defects
were reproduced by these cases. This suite does not establish live database
interoperability, complete csvkit parity, or independent native differential
qualification. The integration owner separately reproduced and fixed pending
result iterator cancellation ownership with two csvkit regression tests. No
native programs, database connections, network or
host file creation are used by these canonical cases.
