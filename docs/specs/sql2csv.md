# sql2csv 2.2.0 source contract

The authority is `csvkit/utilities/sql2csv.py` from the released archive SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`. Its file hash is recorded in `docs/csvkit/sql2csv-reference.json`; capture authenticated the archive, installed source and every frozen distribution against `reference-profile.json` (CPython 3.14.2, Agate 1.14.2, Agate-SQL 0.7.3, SQLAlchemy 2.0.54, SQLite 3.50.4, C locale, UTC). Research-only Python is never a product dependency or canonical-test subprocess.

The literal command implementation is `packages/csvkit/src/commands/sql2csv.ts`. Existing descriptor registration preserves all fourteen executable names. The argv and SDK paths use the same operation, and Safe Bash consumes that actual engine through its explicit `csvkitCommands` plugin. There are no implicit filesystem/network/database/interactive bindings.

## Parser applicability and collisions

The precise option inventory is `-h/--help`, `-v/--verbose`, `-l/--linenumbers`, `-V/--version`, `--db`, `--engine-option`, `--execution-option`, `--query`, `-e/--encoding`, `-H/--no-header-row`, and positional FILE (`?`). Shared `-e` and `-H` are removed by `override_flags` before local redeclaration: encoding defaults to UTF-8 for query input; `-H` suppresses output column names. Ordinary input dialect, type inference, locale, input skipping and BOM flags are absent. There are no duplicate parser destinations or option strings; tests assert an independent literal inventory and exact native rejection diagnostics.

Database defaults to `sqlite://`. Engine/execution options append key/value pairs with Python literal conversion, falling back to raw strings for qualified literal ValueError cases. Last key wins. Execution starts with `no_parameters=True, stream_results=True`; SDK options preserve these defaults just as argparse append does. Malformed option conversion preserves source order: engine conversion before acquisition, execution conversion after connection and query reading.

## Query and result behavior

Truthy `--query` overrides FILE/stdin and strips Python boundary whitespace; an empty query value falls through to FILE/stdin. Connection acquisition precedes query-file opening, decoding and full-file assembly. Query-file and stdin content retain boundary whitespace and universal-newline conversion. Explicit `-e` selects the injected codec; default UTF-8 preserves BOM semantics. The whole query is sent in one driver invocation, including semicolons. There is no csvsql delimiter splitting or filename probing of an explicit query.

Non-row results emit nothing and never acquire a row iterator. Row results preserve ordered labels, duplicates and unnamed labels; zero returned rows still emit a header unless `-H`. The common Agate-profile writer preserves null, driver-tagged float, bigint, bool and CPython binary representation. With `-l`, the first written row gets `line_number` and subsequent rows get numeric indexes. With `-H -l`, this deliberately labels the first data row `line_number`; an empty result emits nothing.

The command never begins or commits a transaction. Frozen pysqlite DML implicitly begins and is rolled back on connection close, whereas first-statement execution option `isolation_level=AUTOCOMMIT` persists DML. Native measurements retain before/after database rows; in-memory memfs/WASM tests compare the actual product binding's effects to those measurements. The SQLite binding qualifies this first-statement AUTOCOMMIT path only; other isolation levels, engine isolation options and changing isolation after a prior query remain named blockers. Explicit SQL transaction effects remain controlled by the driver and supplied query.

## Ownership and limits

The command registers idempotent cleanup before acquisition, closes the row iterator/result before rolling back and disposing its owned session, drains admitted cooperative reads, and awaits output backpressure. It preserves cancellation and original failures, including falsey failures. A session binding's `close` must dispose its owned connection/engine; injected provider ownership itself stays with the host.

Unlike native errors that can escape before connection close/engine dispose, error and cancellation paths always release owned resources. Explicit rollback plus result/iterator close is observable to injected hosts even though native source relies on connection close and cursor exhaustion; this intentionally stronger cleanup is recorded rather than claimed identical. Borrowed stdin is iterated/finalized without a host stream close API; source explicitly closes its Python input stream. Host ownership is preserved, so arbitrary borrowed-stream closure is not promised.

Existing work/memory/input/output/row budgets apply. Qualified ordinary diagnostics use exact frozen stdout/stderr/status. Verbose tracebacks without qualified frozen frames, unmeasured database drivers, unsupported literal/codec cases, driver locking/retry profiles and SQLite build/VFS differences remain explicit blockers under the shared specifications. Fixture-bound driver diagnostics verify command handling, not an independently implemented native driver. A passing focused suite is not full csvkit or full repository qualification.
