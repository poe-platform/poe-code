# SQLite binding independent stress QA

Exercise the public csvkit database binding through actual safe-bash Shell commands and injected MemoryFileSystem only. Do not use an ambient filesystem, process, network, or database service. Run the maintained focused test route, preserving uncached execution.

1. Run sql2csv with its default sqlite:// URL and a CTE, aggregate, scalar conversion, blob and NULL expression. Compare exact stdout, stderr and status against the frozen SQLite 3.50.4/CPython/SQLAlchemy profile. A version mismatch or absent result representation remains a blocker.
2. Insert a CSV into an authorized VFS file URL with csvsql, close the invocation, then select through a fresh sql2csv invocation. Verify persistent database bytes exist only in the authorized VFS namespace.
3. Force a constraint failure midway through insert. Verify exact diagnostics and that the preexisting database remains readable with the original rows after rollback.
4. Exercise a DML query through sql2csv and verify its rollback-on-close behavior against the reference transaction profile. Verify DDL effects separately; CPython legacy transaction control can expose different DDL persistence.
5. Reject ATTACH, VACUUM INTO, load_extension and unsupported URI features as named host divergences before any external acquisition or publication. Inspect authorized VFS entries after each denial.
6. Hold result consumption or acquisition behind a cooperative promise, cancel, and verify cleanup drains admitted work once before execution/dispose settlement.
7. Exercise concurrent file connections and exclusive ownership. Verify only the capabilities actually supplied by the adapter; do not infer POSIX locking or filesystem atomicity from in-memory serialization.

Unsupported, unimplemented and unmeasured paths remain explicit parity blockers. Passing this focused stress suite does not qualify arbitrary SQLite queries or full csvkit compatibility.

For relative file URLs, deliberately give the provider fallback cwd `/` while the actual Shell cwd is `/authorized/sub`. Supply that authorized parent directory in both the command MemoryFileSystem and SQL memfs Volume. Insert via csvsql, select through a fresh sql2csv session, and verify the database exists at `/authorized/sub/rows.db`, never `/rows.db`; inspect journal cleanup after commit. This verifies the invocation-cwd context traverses both shared command engines.
