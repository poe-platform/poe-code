# safe-bash-command-sqlite3

Full SQLite 3 CLI and relational SQL engine over SafeFS virtual filesystems.

Run interactive or scripted SQLite 3 workloads inside @poe-platform/safe-bash with genuine SQLite Format 3 binary B-tree persistence, recursive CTEs, window functions, JSON1, date/time modifiers, triggers, views, and all standard dot-commands.

## Features

- `sqlite3 [OPTIONS] [FILENAME] [SQL]` — Execute SQL statements and dot-commands over in-memory or VFS-backed SQLite Format 3 databases
- **SQL values** — Missing column identifiers report errors; double-quoted text falls back to a string when no column matches. INTEGER, TEXT, NUMERIC, and REAL column affinities apply on inserts, updates, and upserts. REAL literals, sums, absolute values, casts, averages, and arithmetic retain their numeric type, including `.0` in JSON output. Correlated subqueries resolve qualified and unqualified outer columns; JOIN conditions and scalar, EXISTS, and IN subqueries validate columns even on empty tables.
- **Output Modes** — `-csv`, `-json`, `-line`, `-list`, `-column`, `-table`, `-box`, `-markdown`, `-tabs`, `-html`, `-quote`, `-ascii`, and `.mode insert`
- **Dot-Commands** — `.mode`, `.headers`, `.separator`, `.nullvalue`, `.tables`, `.schema`, `.dump`, `.import`, `.output`, `.once`, `.read`, `.databases`, `.indexes`, `.parameter`, `.backup`, `.restore`
- **Full SQL Engine** — DDL (`CREATE/ALTER/DROP`), DML (`INSERT ... ON CONFLICT`, `RETURNING`), Joins, Recursive CTEs, Window Functions, `json_each` / `json_tree`, and `PRAGMA` introspection

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
await shell.exec(`
  sqlite3 /app.db "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1, 'Ada');"
  sqlite3 -json /app.db "SELECT * FROM users;"
`);
```
