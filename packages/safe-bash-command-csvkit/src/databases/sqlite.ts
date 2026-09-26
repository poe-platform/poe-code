import type { CsvWriteCell } from "../csv.js";
import type { SqlValue } from "../contracts.js";
import { CsvkitBlocked } from "../errors.js";
// Frozen SQLAlchemy 2.0.54 identifier/DDL profile; not a DBAPI driver.
import type { DatabaseDialectDescriptor } from "./descriptor.js";
import { PythonException } from '../diagnostics/exception.js';
export const sqlite: DatabaseDialectDescriptor = {
  "name": "sqlite",
  defaultDriver: 'pysqlite',
  drivers: { pysqlite: { module: 'sqlite3', referenceAvailable: true }, aiosqlite: { module: 'aiosqlite' }, pysqlcipher: { module: 'sqlcipher3' } },
  validateUrl(url) {
    if (url.username !== null || url.password !== null || url.host !== null || url.port !== null) {
      if (url.username !== null || url.password !== null) throw new CsvkitBlocked('SQLite invalid credential URL diagnostic rendering');
      throw new PythonException('ArgumentError', `Invalid SQLite URL: ${url.raw}\nValid SQLite URL forms are:\n sqlite:///:memory: (or, sqlite://)\n sqlite:///relative/path/to/file.db\n sqlite:////absolute/path/to/file.db`);
    }
  },
  "quoteStart": "\"",
  "quoteEnd": "\"",
  "reserved": [
    "add",
    "after",
    "all",
    "alter",
    "analyze",
    "and",
    "as",
    "asc",
    "attach",
    "autoincrement",
    "before",
    "begin",
    "between",
    "by",
    "cascade",
    "case",
    "cast",
    "check",
    "collate",
    "column",
    "commit",
    "conflict",
    "constraint",
    "create",
    "cross",
    "current_date",
    "current_time",
    "current_timestamp",
    "database",
    "default",
    "deferrable",
    "deferred",
    "delete",
    "desc",
    "detach",
    "distinct",
    "drop",
    "each",
    "else",
    "end",
    "escape",
    "except",
    "exclusive",
    "exists",
    "explain",
    "fail",
    "false",
    "for",
    "foreign",
    "from",
    "full",
    "glob",
    "group",
    "having",
    "if",
    "ignore",
    "immediate",
    "in",
    "index",
    "indexed",
    "initially",
    "inner",
    "insert",
    "instead",
    "intersect",
    "into",
    "is",
    "isnull",
    "join",
    "key",
    "left",
    "like",
    "limit",
    "match",
    "natural",
    "not",
    "notnull",
    "null",
    "of",
    "offset",
    "on",
    "or",
    "order",
    "outer",
    "plan",
    "pragma",
    "primary",
    "query",
    "raise",
    "references",
    "reindex",
    "rename",
    "replace",
    "restrict",
    "right",
    "rollback",
    "row",
    "select",
    "set",
    "table",
    "temp",
    "temporary",
    "then",
    "to",
    "transaction",
    "trigger",
    "true",
    "union",
    "unique",
    "update",
    "using",
    "vacuum",
    "values",
    "view",
    "virtual",
    "when",
    "where"
  ],
  "illegalInitial": [
    "$",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9"
  ],
  "typedTypes": {"Number": "FLOAT"},
  bindValue: sqliteValue,
  "placeholder": "?"
};

/** Frozen SQLAlchemy SQLite bind processors, independent of invocation I/O. */
function sqliteValue(value: CsvWriteCell): SqlValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (value.kind === 'decimal' || value.kind === 'float') return Number(value.value);
  if (value.kind === 'date') return value.value;
  if (value.kind === 'datetime') {
    const date = value.value.slice(0, 10), time = value.value.slice(11, 19);
    let fraction = '';
    if (value.value[19] === '.') for (const char of value.value.slice(20)) {
      if (!'0123456789'.includes(char)) break;
      fraction += char;
    }
    return date + ' ' + time + '.' + fraction.padEnd(6, '0');
  }
  if (value.kind === 'timedelta') {
    const micros = value.microseconds;
    const millis = micros / 1000n - (micros % 1000n < 0n ? 1n : 0n);
    const date = new Date(Number(millis));
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw new CsvkitBlocked('SQLite interval bind range');
    const remainder = (micros % 1000000n + 1000000n) % 1000000n;
    return date.toISOString().slice(0, 19).replace('T', ' ') + '.' + String(remainder).padStart(6, '0');
  }
  throw new CsvkitBlocked(`SQLite bind processor ${value.kind}`);
}
