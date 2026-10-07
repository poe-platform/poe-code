# SQLite runtime

Run native SQLite with a caller-owned virtual filesystem in Node or Cloudflare Workers. Each runtime has its own native memory and one reusable unicode61 callback slot. Worker builds import precompiled WebAssembly assets; Node compiles the same embedded executable bytes on first use, including after bundling.

The runtime provides SQLite 3.53.0 from `@journeyapps/wa-sqlite` 2.0.6 and its `FacadeVFS` bridge. Register your filesystem before opening a database. The caller owns bounded I/O, connection lifetimes, cancellation, private storage and atomic publication; this package does not create temporary data files or install a memory filesystem.

```js
import { createSqliteRuntime, FacadeVFS } from 'safe-bash-sqlite-engine';
const runtime = await createSqliteRuntime({ signal });
const vfs = Object.assign(new FacadeVFS('private', runtime.module), callbacks);
runtime.module.vfs_register(vfs, true);
```

For a caller-owned private directory, `safe-bash-sqlite-engine/safe-fs` provides
`createSqliteVfs({ fs, directory, signal, maxOpenFiles, maxFileBytes })`. Assign
its callbacks to `FacadeVFS` as above. The filesystem must support positioned
descriptor reads/writes, truncate and sync. Transfers use owned buffers of at
most 16 KiB, retry short transfers, and preserve the original filesystem or
cancellation error through `callbacks.throwIfFailed()`. Close the native
connection before awaiting `callbacks.dispose()` to release remaining handles.

The caller must exclusively own the directory for the connection's lifetime;
the adapter does not lock shared database paths or publish staged databases.
Only direct child files are admitted, temporary files are exclusively created
and removed on close, and file growth and open handles are budgeted. Use this
adapter for private transaction working files, with the caller responsible for
retained source acquisition, atomic publication and removal of the directory.

`safe-bash-sqlite-engine/storage` adds `transactSqlite()` for canonical database
files. It retains the database and WAL/journal/SHM identities, recovers a private
snapshot, executes a native transaction, and atomically publishes only if the
original source set still matches. Failed work leaves canonical files unchanged.
The result includes the callback value, a committed file receipt and separate
cleanup errors: a committed operation must not be retried because cleanup failed.

```js
import { transactSqlite, withSqliteStatement } from 'safe-bash-sqlite-engine/storage';
const receipt = await transactSqlite({
  fs, path: '/embeddings.db', signal,
  maxFileBytes: 1024 * 1024 * 1024, maxIndexBytes: 16 * 1024 * 1024, maxOpenFiles: 16,
}, async session => {
  await session.execute('CREATE TABLE IF NOT EXISTS collections(name TEXT UNIQUE)');
  await withSqliteStatement(session.module, {
    ...session, signal, sql: 'INSERT INTO collections(name) VALUES (?)',
  }, async statement => {
    for await (const row of statement.rows(['documents'], [])) void row;
  });
});
```

`withSqliteReadSession({ fs, path, directory, signal, maxFileBytes, maxIndexBytes, maxOpenFiles, attachments? }, callback)` queries private snapshots without publishing canonical changes. Attachments are `{ alias, path }` pairs and use the same retained source acquisition and bounded copying as transactions. WAL and rollback recovery happen in caller-owned scratch storage; canonical database and sidecar identities remain unchanged. Once acquired, snapshots remain stable if the caller later changes the original files. Canonical source filenames remain visible to SQL introspection, including repeated attachments and resolved symlinks. Final source symlinks require synchronous followed-resolution guards; their canonical target owns the sidecar set, and retargeting during acquisition aborts before copying. The session enables SQLite query-only mode, and all native resources expire when the callback returns. This scalar session API does not provide arbitrary large query-result streaming.

`withSqliteQueryRecords({ ...snapshotOptions, sql }, async (rows, columns) => ...)` stages SELECT/WITH/VALUES results as SQLite records in a separate private caller-backed file and exposes ordered `SqliteRecordValue` field streams. Column names retain original duplicates; native text is exposed as UTF-8 through bounded transfers. Sources and native connections close before consumption, and result streams expire with the callback. Computed queries yield cooperatively to cancellation. Result staging does not enter the SQL attachment namespace or consume an attachment slot. Native expression evaluation and UTF-8 conversion can still allocate complete SQLite values; database-list introspection reports canonical caller filenames while all database and recovery-sidecar IO stays in owned snapshots. This API bounds JavaScript field transfers and result storage, not arbitrary native expression working memory.

`prepareSqliteAttachments({ ...snapshotOptions, attachments })` validates sqlite-utils attachment aliases and database contents in order before application migrations. Missing main and attachment files are created empty; existing data is validated through owned snapshots without publication. Failed aliases do not create their attachment file, and failures/cancellation retire private storage.

The supplied filesystem must support retained reads, synchronous binding guards,
conditional file ownership and atomic source-set publication. All private files
and staging use that filesystem. The native page cache is bounded; file copying,
WAL indexing and publication use bounded buffers and caller storage. Native calls
must be serialized inside the callback, and sessions/cursors must not escape it.
SQL and aggregate scalar bindings are limited to 64 KiB. Use `writeSqliteBlob()`
and `readSqliteBlob()` for large values. A transaction's optional `finalize`
callback can rewrite a known row using streamed `sqliteRecord()` fields, then
validate it through a native session before publication; the caller must preserve
the row's indexes and constraints. `editor.rewriteRecords(records)` accepts an
async iterable and copies its destination snapshot once for the complete batch.
Use `editor.withSnapshot(async (source, target) => ...)` to retain an immutable
source while the nested target editor creates or rewrites rows. Find records with
`source.findRecord(rootPage, rowid, "at-or-after")`; `readSqliteRecord(record,
{ signal, maxColumns })` decodes bounded headers/scalars and leaves TEXT/BLOB
fields as replayable byte streams. Source records and streams expire with the
callback. Keep reads and target operations serialized and await every operation.
This is storage infrastructure and defines no
application schema, migrations or logging behavior.
