import type init from '@sqlite.org/sqlite-wasm';
import type { DatabaseProvider, DatabaseSession, DatabaseResult, DatabaseCell, SqlValue } from './contracts.js';
import { CsvkitBlocked, CsvkitDiagnostic } from './errors.js';
import { floatText } from './operations/json-table.js';
import { virtualPath } from './io/index.js';
import type { SQLiteFileSystem } from './sqlite-vfs.js';
import { installSqliteVfs } from './sqlite-vfs-install.js';
import { parseDatabaseUrl } from './database-url.js';
import { sqlite as sqliteDialect } from './databases/sqlite.js';
import { repr } from './cli/parser.js';
import { bytesRepr } from './operations/dbf-files.js';

/** SQLAlchemy 2.0.54's bounded tuple/list parameter diagnostic profile. */
function parameterTuple(values: readonly SqlValue[]): string {
  const valueText = (raw: SqlValue): string => {
    const value = raw && typeof raw === 'object' && !(raw instanceof Uint8Array) ? sqliteDialect.bindValue!(raw) : raw;
    const text = value === null ? 'None' : typeof value === 'string' ? repr(value) :
      typeof value === 'bigint' ? String(value) : typeof value === 'boolean' ? value ? 'True' : 'False' :
      typeof value === 'number' ? Number.isNaN(value) ? 'nan' : !Number.isFinite(value) ? value < 0 ? '-inf' : 'inf' : floatText(value) :
      value instanceof Uint8Array ? bytesRepr(value) : undefined;
    if (text === undefined) throw new CsvkitBlocked('SQLite parameter repr profile');
    const chars = Array.from(text);
    return chars.length > 300 ? chars.slice(0, 150).join('') + ` ... (${chars.length - 300} characters truncated) ... ` + chars.slice(-150).join('') : text;
  };
  if (values.length > 100) return '(' + values.slice(0, 50).map(valueText).join(', ') +
    ` ... ${values.length - 100} parameters truncated ... ` + values.slice(-50).map(valueText).join(', ') + ')';
  return '(' + values.map(valueText).join(', ') + (values.length === 1 ? ',' : '') + ')';
}

function parameterBatch(rows: readonly (readonly SqlValue[])[]): string {
  if (rows.length === 1) return parameterTuple(rows[0]!);
  if (rows.length > 10) return '[' + rows.slice(0, 8).map(parameterTuple).join(', ') +
    `  ... displaying 10 of ${rows.length} total bound parameter sets ...  ` + rows.slice(-2).map(parameterTuple).join(', ') + ']';
  return '[' + rows.map(parameterTuple).join(', ') + ']';
}

class SQLiteStatementError extends CsvkitDiagnostic {
  constructor(readonly kind: string, readonly detail: string, readonly sql: string, parameters?: string) {
    super(`${kind}: (sqlite3.${kind}) ${detail}\n[SQL: ${sql}]\n${parameters ? `[parameters: ${parameters}]\n` : ''}(Background on this error at: https://sqlalche.me/e/20/${kind === 'IntegrityError' ? 'gkpj' : kind === 'DataError' ? '9h9h' : 'e3q8'})`);
  }
}

/** Opaque, trusted initialized infrastructure; upstream API stays out of the SDK closure. */
export type SQLiteRuntime = object;
export interface SQLiteDatabaseProvider extends DatabaseProvider { dispose(): Promise<void> }
export interface SQLiteOptions {
  /** Already initialized, explicitly authorized SQLite 3.50.4 WASM infrastructure. */
  readonly sqlite: SQLiteRuntime;
  readonly cwd: string;
  readonly clock: { now(): number };
  readonly random: (bytes: Uint8Array) => void;
  readonly vfs?: SQLiteFileSystem;
  readonly limits?: Partial<{ maxWork: number; maxSqlBytes: number; maxValueBytes: number; maxResultRows: number }>;
}

// CPython's tail check permits only whitespace/comments after the first statement.
function skipTrivia(sql: string, start = 0): number {
  let index = start;
  while (index < sql.length) {
    if (' \t\r\n\f'.includes(sql[index]!)) { index++; continue; }
    if (sql.slice(index, index + 2) === '--') {
      const end = sql.indexOf('\n', index + 2); index = end < 0 ? sql.length : end + 1; continue;
    }
    if (sql.slice(index, index + 2) === '/*') {
      const end = sql.indexOf('*/', index + 2); index = end < 0 ? sql.length : end + 2; continue;
    }
    break;
  }
  return index;
}

/** No runtime loading, subprocesses, ambient files, URI resolution or implicit drivers. */
export function createSqliteDatabaseProvider(settings: SQLiteOptions): SQLiteDatabaseProvider {
  const { clock, random, cwd } = settings;
  const sqlite = settings.sqlite as Awaited<ReturnType<typeof init>>;
  const { capi: c, wasm } = sqlite;
  if (c.sqlite3_libversion() !== '3.50.4') throw new CsvkitBlocked('SQLite runtime must be 3.50.4');
  if (c.sqlite3_sourceid() !== '2025-07-30 19:33:53 4d8adfb30e03f9cf27f800a2c1ba3c48fb4ca1b08b0f5ed59a4d5ecbf45e20a3') throw new CsvkitBlocked('SQLite source revision does not match reference');
  const limits = Object.freeze({ maxWork: Infinity, maxSqlBytes: Infinity, maxValueBytes: Infinity, maxResultRows: Infinity, ...settings.limits });
  for (const [name, value] of Object.entries(limits)) if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 0) throw new TypeError(`SQLite ${name} must be a nonnegative safe integer or Infinity`);
  const vfs = installSqliteVfs(sqlite, settings.vfs, clock, random);
  const profile = 'sqlite-wasm-3.50.4-cpython-legacy';
  const sessions = new Set<DatabaseSession>();
  let disposed = false, disposal: Promise<void> | undefined;
  return Object.freeze({ schemes: Object.freeze(['sqlite', 'sqlite+pysqlite']), profile,
    dispose() {
      disposed = true;
      return disposal ??= Promise.resolve().then(async () => {
        const results = await Promise.allSettled([...sessions].map(session => session.close()));
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        try { vfs.dispose(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'SQLite provider disposal failed');
      });
    },
    async connect(url, options, signal, invocation): Promise<DatabaseSession> {
      signal.throwIfAborted();
      if (disposed) throw new Error('SQLite provider disposed');
      // SQLAlchemy 2 already uses the future API; disabling echo adds no logging.
      if (Object.entries(options).some(([key, value]) => !((key === 'echo' && value === false) || (key === 'future' && value === true))))
        throw new CsvkitBlocked('SQLite engine options profile');
      const parsed = parseDatabaseUrl(url);
      if (!['sqlite', 'sqlite+pysqlite'].includes(parsed.drivername)) throw new CsvkitBlocked('SQLite connection URL');
      sqliteDialect.validateUrl!(parsed);
      if (url.includes('?') || url.includes('#') || url.includes('\0')) throw new CsvkitBlocked('SQLite host divergence: URI/query/fragment features');
      let filename = ':memory:';
      if (parsed.database && parsed.database !== ':memory:') {
        if (!settings.vfs) throw new CsvkitBlocked('SQLite file VFS is not bound');
        const path = parsed.database;
        if (path.startsWith('file:')) throw new CsvkitBlocked('SQLite host divergence: file URI features');
        // SQLAlchemy SQLite paths are literal: do not percent-decode filenames.
        filename = virtualPath(invocation?.cwd ?? cwd, path);
      }
      let db: InstanceType<typeof sqlite.oo1.DB>;
      vfs.takeFailure();
      try { db = new sqlite.oo1.DB(filename, 'c', vfs.name); }
      catch (error) { const hostFailure = vfs.takeFailure(); if (hostFailure instanceof CsvkitBlocked) throw hostFailure; throw error; }
      try {
        // This build omits dynamic extension loading. Register only a denied name
        // so SQLite's own authorizer can report the named capability divergence.
        db.createFunction({ name: 'load_extension', arity: -1, xFunc: () => { throw new CsvkitBlocked('SQLite host divergence: load_extension'); } });
        db.createFunction({ name: 'regexp', arity: 2, xFunc: () => { throw new CsvkitBlocked('SQLite host divergence: regexp'); } });
        // Upstream runtime supports void callbacks after sqlite3_result_*;
        // its ScalarFunctionOptions declaration omits that return type.
        db.createFunction({ name: 'floor', arity: 1, deterministic: true, xFunc: (context: number, value: unknown) => {
          if (typeof value !== 'bigint' && typeof value !== 'number') {
            c.sqlite3_result_error(context, 'user-defined function raised exception', -1);
          } else if (typeof value === 'number' && !Number.isFinite(value)) {
            c.sqlite3_result_error_toobig(context);
          } else {
            const integer = typeof value === 'bigint' ? value : BigInt(Math.floor(value));
            if (integer < -9223372036854775808n || integer > 9223372036854775807n) c.sqlite3_result_error_toobig(context);
            // The upstream convenience converter may publish exactly representable
            // BigInts as REAL. CPython's math.floor callback always returns INTEGER.
            else c.sqlite3_result_int64(context, integer);
          }
          return undefined;
        } } as unknown as Parameters<typeof db.createFunction>[0]);
        const pointer = db.pointer!;
        c.sqlite3_db_config(pointer, c.SQLITE_DBCONFIG_DQS_DML, 1, 0);
        c.sqlite3_db_config(pointer, c.SQLITE_DBCONFIG_DQS_DDL, 1, 0);
        const getAutocommit = wasm.xWrap('sqlite3_get_autocommit', 'int', ['*']) as (db: number) => number;
        const columnText = wasm.xWrap('sqlite3_column_text', '*', ['*', 'int']) as (statement: number, index: number) => number;
        // The pinned upstream NULL wrapper discards the C return code. Bind
        // directly so the normal SQLite error checks receive the real status.
        const bindNull = wasm.xWrap('sqlite3_bind_null', 'int', ['*', 'int']) as (statement: number, index: number) => number;
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        let closed = false, work = 0, activeSignal = signal, blocked: CsvkitBlocked | undefined;
        const statements = new Set<number>();
        let autocommit = false, queried = false, logicalTransaction = false;
        const control = (sql: string): void => {
          try { db.exec(sql); }
          catch (error) {
            activeSignal.throwIfAborted();
            const hostFailure = vfs.takeFailure();
            if (hostFailure instanceof CsvkitBlocked) throw hostFailure;
            if (blocked) { const denial = blocked; blocked = undefined; throw denial; }
            throw error;
          }
        };
        if (Number.isFinite(limits.maxValueBytes)) c.sqlite3_limit(pointer, c.SQLITE_LIMIT_LENGTH, limits.maxValueBytes);
        if (Number.isFinite(limits.maxSqlBytes)) c.sqlite3_limit(pointer, c.SQLITE_LIMIT_SQL_LENGTH, limits.maxSqlBytes);
        c.sqlite3_progress_handler(pointer, 100, () => {
          work += 100;
          if (activeSignal.aborted) return 1;
          if (work > limits.maxWork) { blocked = new CsvkitBlocked('SQLite VM work budget exceeded'); return 1; }
          return 0;
        }, 0);
        c.sqlite3_set_authorizer(pointer, (_context, action, a, b) => {
          const arg1 = String(a).toLowerCase(), arg2 = String(b).toLowerCase();
          let divergence: string | undefined;
          if (action === c.SQLITE_ATTACH || action === c.SQLITE_DETACH) divergence = 'ATTACH/DETACH and VACUUM';
          if (action === c.SQLITE_FUNCTION && ['load_extension', 'readfile', 'writefile'].includes(arg2)) divergence = arg2;
          if (action === c.SQLITE_FUNCTION && arg2 === 'regexp') divergence = `SQLAlchemy Python function ${arg2}`;
          if (action === c.SQLITE_FUNCTION && ['sqlite_compileoption_get', 'sqlite_compileoption_used'].includes(arg2)) divergence = 'SQLite compile profile introspection';
          if (action === c.SQLITE_CREATE_VTABLE && ['fts3', 'fts4', 'geopoly'].includes(arg2)) divergence = `unqualified virtual table module ${arg2}`;
          if (action === c.SQLITE_PRAGMA && (
            ['encoding', 'compile_options', 'function_list', 'temp_store_directory', 'data_store_directory', 'mmap_size', 'case_sensitive_like', 'count_changes', 'default_cache_size', 'empty_result_callbacks', 'full_column_names', 'short_column_names', 'threads', 'busy_timeout'].includes(arg1) ||
            (arg1 === 'journal_mode' && arg2 === 'wal') || (arg1 === 'temp_store' && ['0', '1', 'default', 'file'].includes(arg2)))) divergence = `PRAGMA ${arg1} ${arg2}`;
          if (!divergence) return c.SQLITE_OK;
          blocked = new CsvkitBlocked(`SQLite host divergence: ${divergence}`);
          return c.SQLITE_DENY;
        }, 0);
        control('PRAGMA temp_store=MEMORY');
        control('PRAGMA page_size=4096');
        control('PRAGMA cache_size=-2000');
        const check = (rc: number, sql: string, values: readonly SqlValue[]): void => {
          activeSignal.throwIfAborted();
          const hostFailure = vfs.takeFailure();
          if (hostFailure instanceof CsvkitBlocked) throw hostFailure;
          if (blocked) { const error = blocked; blocked = undefined; throw error; }
          if (rc === c.SQLITE_OK || rc === c.SQLITE_ROW || rc === c.SQLITE_DONE) return;
          const integrity = (rc & 255) === c.SQLITE_CONSTRAINT;
          const kind = integrity ? 'IntegrityError' : (rc & 255) === c.SQLITE_TOOBIG ? 'DataError' : 'OperationalError';
          throw new SQLiteStatementError(kind, c.sqlite3_errmsg(pointer), sql, values.length ? parameterTuple(values) : undefined);
        };
        const finish = (statement: number): void => { if (statements.delete(statement)) c.sqlite3_finalize(statement); };
        const session: DatabaseSession = {
          profile, dialect: 'sqlite',
          async begin(nextSignal) {
            nextSignal.throwIfAborted();
            if (closed) throw new Error('SQLite session closed');
            if (logicalTransaction || getAutocommit(pointer) === 0) throw new CsvkitBlocked('SQLite repeated logical begin diagnostic profile');
            // SQLAlchemy begins a logical transaction here. Legacy pysqlite
            // leaves DDL/SELECT in autocommit until the first DML statement.
            activeSignal = nextSignal; logicalTransaction = true;
          },
          async commit(nextSignal) {
            nextSignal.throwIfAborted(); if (closed) throw new Error('SQLite session closed');
            activeSignal = nextSignal;
            if (getAutocommit(pointer) === 0) control('COMMIT');
            logicalTransaction = false;
          },
          async rollback() {
            if (closed) return;
            if (getAutocommit(pointer) === 0) {
              activeSignal = new AbortController().signal; blocked = undefined; work = 0; control('ROLLBACK');
            }
            logicalTransaction = false;
          },
          async close() {
            if (closed) return;
            for (const statement of [...statements]) finish(statement);
            try { await session.rollback(); }
            finally { db.close(); closed = true; sessions.delete(session); }
          },
          async hasTable(name, schema, nextSignal) {
            nextSignal.throwIfAborted();
            if (closed) throw new Error('SQLite session closed');
            // SQLAlchemy excludes temp from explicit schema names; ATTACH is unbound.
            if (schema !== null && schema !== 'main') return false;
            for (const source of schema === null ? ['main', 'temp'] : [schema]) {
              const namespace = source.split('"').join('""');
              const result = await session.query(`SELECT name FROM "${namespace}".sqlite_master WHERE type IN ('table','view') AND name=? COLLATE NOCASE`, [name], {}, nextSignal);
              try { for await (const _row of result.rows) return true; }
              finally { await result.close(); }
            }
            return false;
          },
          async executeMany(sql, rows, nextSignal) {
            nextSignal.throwIfAborted();
            if (closed) throw new Error('SQLite session closed');
            if (rows.length > limits.maxResultRows) throw new CsvkitBlocked('SQLite parameter batch row budget exceeded');
            try {
              for (const row of rows) {
                nextSignal.throwIfAborted();
                const result = await session.query(sql, row, {}, nextSignal);
                try {
                  if (result.columns !== null) throw new CsvkitBlocked('SQLite executemany returned-row profile');
                } finally { await result.close(); }
              }
            } catch (failure) {
              if (failure instanceof SQLiteStatementError) throw new SQLiteStatementError(failure.kind, failure.detail, failure.sql, rows.length ? parameterBatch(rows) : undefined);
              throw failure;
            }
            return { columns: null, rows: (async function* () {})(), close: async () => {} };
          },
          async query(sql, values, executionOptions, nextSignal): Promise<DatabaseResult> {
            nextSignal.throwIfAborted();
            if (closed) throw new Error('SQLite session closed');
            if (Object.keys(executionOptions).some(key => !['no_parameters', 'stream_results', 'isolation_level'].includes(key))) throw new CsvkitBlocked('SQLite execution options profile');
            if ('isolation_level' in executionOptions) {
              // Qualified against SQLAlchemy's first-statement AUTOCOMMIT path.
              // Changing isolation after autobegin needs a separate profile.
              if (executionOptions.isolation_level !== 'AUTOCOMMIT' || queried || logicalTransaction || getAutocommit(pointer) === 0)
                throw new CsvkitBlocked('SQLite isolation level profile');
              autocommit = true;
            }
            if (sql.includes('\0')) throw new CsvkitDiagnostic('ProgrammingError: the query contains a null character');
            if (new TextEncoder().encode(sql).byteLength > limits.maxSqlBytes) throw new CsvkitBlocked('SQLite SQL byte budget exceeded');
            activeSignal = nextSignal; blocked = undefined; queried = true; logicalTransaction = true;
            let statement = 0;
            const scope = wasm.scopedAllocPush();
            try {
              const text = wasm.scopedAllocCString(sql, false), output = wasm.scopedAlloc(8);
              wasm.pokePtr(output, 0); wasm.pokePtr(output + 4, 0);
              check(c.sqlite3_prepare_v3(pointer, text, -1, 0, output, output + 4), sql, values);
              statement = wasm.peekPtr(output);
              if (statement) statements.add(statement);
              const tail = wasm.cstrToJs(wasm.peekPtr(output + 4)) ?? '';
              if (skipTrivia(tail) < tail.length) throw new CsvkitDiagnostic('ProgrammingError: (sqlite3.ProgrammingError) You can only execute one statement at a time.\n[SQL: ' + sql + ']\n(Background on this error at: https://sqlalche.me/e/20/f405)');
              if (statement && c.sqlite3_bind_parameter_count(statement) !== values.length) throw new CsvkitBlocked('SQLite parameter count diagnostic profile');
              for (const [index, rawValue] of values.entries()) {
                const value = rawValue && typeof rawValue === 'object' && !(rawValue instanceof Uint8Array) ? sqliteDialect.bindValue!(rawValue) : rawValue;
                let rc: number;
                if (value === null) rc = bindNull(statement, index + 1);
                else if (typeof value === 'bigint') rc = c.sqlite3_bind_int64(statement, index + 1, value);
                else if (typeof value === 'number') rc = c.sqlite3_bind_double(statement, index + 1, value);
                else if (typeof value === 'boolean') rc = c.sqlite3_bind_int64(statement, index + 1, value ? 1n : 0n);
                else if (typeof value === 'string') {
                  const [text, size] = wasm.scopedAllocCString(value, true);
                  rc = c.sqlite3_bind_text(statement, index + 1, text, size, c.SQLITE_TRANSIENT);
                } else if (value instanceof Uint8Array) {
                  const bytes = wasm.scopedAlloc(Math.max(1, value.byteLength));
                  wasm.heap8u().set(value, bytes);
                  rc = c.sqlite3_bind_blob(statement, index + 1, bytes, value.byteLength, c.SQLITE_TRANSIENT);
                } else throw new CsvkitBlocked('SQLite typed binding profile');
                check(rc, sql, values);
              }
            } catch (failure) { finish(statement); throw failure; }
            finally { wasm.scopedAllocPop(scope); }
            if (!statement) return { columns: null, rows: (async function* () {})(), close: async () => {} };
            try {
              const first = skipTrivia(sql);
              let end = first; while (end < sql.length && 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.includes(sql[end]!)) end++;
              if (!autocommit && ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(sql.slice(first, end).toUpperCase()) && getAutocommit(pointer)) control('BEGIN');
              // pysqlite execute steps once before publishing cursor.description/errors.
              let rc = c.sqlite3_step(statement); check(rc, sql, values);
              const count = c.sqlite3_column_count(statement);
              const columns = count ? Array.from({ length: count }, (_, index) => c.sqlite3_column_name(statement, index)) : null;
              let rowCount = 0, consumed = false;
              const rows = { async *[Symbol.asyncIterator]() {
                if (consumed) throw new Error('SQLite result already consumed');
                consumed = true;
                try {
                  while (statements.has(statement) && rc === c.SQLITE_ROW) {
                    activeSignal = nextSignal; nextSignal.throwIfAborted();
                    if (++rowCount > limits.maxResultRows) throw new CsvkitBlocked('SQLite result row budget exceeded');
                    const row: DatabaseCell[] = [];
                    for (let index = 0; index < count; index++) {
                      const type = c.sqlite3_column_type(statement, index);
                      if (type === c.SQLITE_INTEGER) row.push(c.sqlite3_column_int64(statement, index));
                      else if (type === c.SQLITE_FLOAT) row.push({ kind: 'float', value: floatText(c.sqlite3_column_double(statement, index)) });
                      else if (type === c.SQLITE_TEXT) {
                        const textPointer = columnText(statement, index);
                        const bytes = wasm.heap8u().subarray(textPointer, textPointer + c.sqlite3_column_bytes(statement, index));
                        try { row.push(decoder.decode(bytes)); }
                        catch { throw new CsvkitBlocked('SQLite invalid UTF-8 TEXT diagnostic profile'); }
                      } else row.push(c.sqlite3_column_js(statement, index) as SqlValue);
                    }
                    yield row;
                    if (!statements.has(statement)) break;
                    nextSignal.throwIfAborted(); activeSignal = nextSignal;
                    rc = c.sqlite3_step(statement); check(rc, sql, values);
                  }
                } finally { finish(statement); }
              } };
              if (rc === c.SQLITE_DONE) finish(statement);
              return { columns, rows, close: async () => finish(statement) };
            } catch (failure) { finish(statement); throw failure; }
          }
        };
        sessions.add(session); return session;
      } catch (error) {
        try { db.close(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'SQLite connection setup and cleanup failed'); }
        throw error;
      }
    }
  } satisfies SQLiteDatabaseProvider);
}
