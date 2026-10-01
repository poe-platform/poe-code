# safe-bash-command-sqlite3

Full SQLite 3 CLI and relational SQL engine over SafeFS virtual filesystems.

Run interactive or scripted SQLite 3 workloads inside @poe-platform/safe-bash with genuine SQLite Format 3 binary B-tree persistence, recursive CTEs, window functions, JSON1, date/time modifiers, triggers, views, and all standard dot-commands.

## Features

- `sqlite3 [OPTIONS] [FILENAME] [SQL]` — Execute SQL statements and dot-commands over in-memory or VFS-backed SQLite Format 3 databases, including signed rowids and multi-page `WITHOUT ROWID` tables
- **SQL values** — Missing column identifiers report errors; double-quoted text falls back to a string when no column matches. INTEGER, TEXT, NUMERIC, and REAL column affinities apply on inserts, updates, and upserts, preserving exact signed 64-bit integer strings. Integer arithmetic, bitwise operations, ABS, SUM, and INTEGER casts retain signed 64-bit precision; arithmetic overflow becomes REAL and integer SUM and ABS overflow report errors. DISTINCT, grouping, compound queries, window functions, JSON constructors, and JSON output preserve large integers. INSERT/UPDATE/DELETE aliases, UPDATE FROM sources, and CTEs resolve throughout mutation expressions; RETURNING supports table-qualified columns and rowid aliases. REAL literals, sums, absolute values, casts, averages, and arithmetic retain their numeric type, including `.0` in JSON output. COALESCE, IFNULL, and IIF evaluate only the selected arguments and retain aggregate and window values inside nested expressions and HAVING predicates. Correlated subqueries resolve qualified and unqualified outer columns; JOIN conditions and scalar, EXISTS, and IN subqueries validate columns even on empty tables. Recursive members, UPDATE/DELETE expressions, RETURNING, and LIMIT/OFFSET subqueries are validated before row evaluation; empty correlated table-function joins retain their result columns.
- **Output Modes** — `-csv`, `-json`, `-line`, `-list`, `-column`, `-table`, `-box`, `-markdown`, `-tabs`, `-html`, `-quote`, `-ascii`, and `.mode insert`
- **Dot-Commands** — `.mode`, `.headers`, `.separator`, `.nullvalue`, `.tables`, `.schema`, `.dump`, `.import`, `.output`, `.once`, `.read`, `.databases`, `.indexes`, `.parameter`, `.backup`, `.restore`. Switching to `.mode list` restores pipe-separated columns and LF rows; `.separator` overrides list, tabs, ASCII, and CSV output. `.tables PATTERN` uses SQL LIKE matching: `%` matches any sequence and `_` matches one character; punctuation is literal. Imports into existing tables apply column affinity, including REAL, FLOAT, and DOUBLE storage types.
- **Persistence** — SQL comments and write CTEs preserve changes when reopening a database. `-readonly` rejects SQL mutations, `.import`, and `.restore`. `NATURAL JOIN` and `JOIN ... USING` emit shared columns once in `SELECT *`, while qualified stars retain every source column.
- **Full SQL Engine** — DDL (`CREATE/ALTER/DROP`), DML (`INSERT ... ON CONFLICT`, `RETURNING`), Joins, Recursive CTEs, Window Functions, `json_each` / `json_tree`, and `PRAGMA` introspection

Without an outer `ORDER BY`, window queries follow the first projected window's partition and sort keys, matching the pinned SQLite 3.43.2 traversal. Use an outer `ORDER BY` whenever your application requires a guaranteed result order.

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
await shell.exec(`
  sqlite3 /app.db "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1, 'Ada');"
  sqlite3 -json /app.db "SELECT * FROM users;"
`);
```

Configure resource budgets through `createSqlite3Commands({ limits: { maxInputBytes, maxOutputBytes, maxRows } })` (also supported by the command factory and plugin). Limits accept nonnegative safe integers or `Infinity`, which is the default. Input and output bytes are cumulative per invocation, including UTF-8 SQL, stdin, input files, database loads, redirected output and database saves. `maxRows` bounds each query result set, generated CTE/series/join rows, and the total stored table rows. Exceeding a limit fails the command and prevents automatic database persistence; unknown dot-commands also fail with an error. Recursive CTEs, series generation, scans, joins, and scripts cooperatively yield and honor cancellation, including Workers with a frozen clock. Recursive queries, series, and blobs have no additional fixed caps. `.mode csv` uses CRLF; the `-csv` flag uses LF.
