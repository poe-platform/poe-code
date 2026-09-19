import type { DatabaseCell, DatabaseResult, DatabaseSession, SqlValue } from './contracts.js';
import { createDatabaseProvider, type DatabaseProviderDescriptor, type DatabaseConnectionRequest } from './database-provider.js';
import { databases } from './databases.js';
import { sqlTransportProfiles } from './sql-transports.js';
import { CsvkitBlocked, CsvkitDiagnostic, CsvkitCleanupError } from './errors.js';
import type { SqlTransportProfile } from './sql-transports/descriptor.js';
import { freezeDescriptor } from './descriptor.js';

/** The host binds native driver operations and cooperative cancellation explicitly.
 * No ambient module loading, network grant or subprocess is performed here. */
export interface SqlTransportStatement {
  readonly sql: string;
  readonly values: readonly SqlValue[];
  readonly options: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}
export interface SqlTransportCursor {
  readonly columns: readonly string[] | null;
  read(signal: AbortSignal): Promise<readonly DatabaseCell[] | null>;
  /** Must request interruption even while a read is pending. */
  cancel(): Promise<void>;
  close(): Promise<void>;
}
export interface SqlTransportConnection {
  execute(statement: SqlTransportStatement): Promise<SqlTransportCursor>;
  executeMany?(statement: Omit<SqlTransportStatement, 'values'> & { readonly rows: readonly (readonly SqlValue[])[] }): Promise<SqlTransportCursor>;
  transaction(operation: 'begin' | 'commit' | 'rollback', signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
export interface SqlTransportOptions extends Omit<DatabaseProviderDescriptor, 'schemes' | 'transport' | 'connect'> {
  /** One shipped name or an independently configured additional profile. */
  readonly transportProfile?: SqlTransportProfile;
  readonly compiler?: import('./databases/descriptor.js').DatabaseDialectDescriptor;
  readonly connect?: (request: DatabaseConnectionRequest, signal: AbortSignal) => Promise<SqlTransportConnection>;
  readonly driver?: import('./sql-native.js').SqlNativeDriver;
  /** Only a qualified error codec can claim native deployment diagnostic identity. */
  readonly diagnostic?: (error: unknown, statement: string | null) => CsvkitDiagnostic;
}

export function createSqlTransportProvider(settings: SqlTransportOptions) {
  const selected = settings.transportProfile ?? sqlTransportProfiles.find(profile => profile.name === settings.profile);
  if (!selected) throw new CsvkitBlocked(`SQL transport profile ${settings.profile}`);
  const profile = freezeDescriptor({ ...selected, schemes: [...selected.schemes] });
  const compiler = settings.compiler ?? databases.find(dialect => dialect.name === profile.dialect);
  if (!compiler || compiler.name !== profile.dialect) throw new CsvkitBlocked(`SQL transport compiler ${profile.dialect}`);
  // Native JavaScript positional/named transports do not use DBAPI percent interpolation.
  const sqlDialect = freezeDescriptor({ ...compiler, doublePercent: false, bindValue: profile.bindValue, parameter: profile.parameter });
  const nativeDriver = settings.driver;
  if (settings.connect && nativeDriver) throw new TypeError('SQL transport accepts one explicit connection binding');
  const open = settings.connect ?? (nativeDriver && profile.open ? (request: DatabaseConnectionRequest, signal: AbortSignal) => profile.open!(nativeDriver, request, signal) : undefined);
  if (!open) throw new CsvkitBlocked(`SQL transport ${profile.name} explicit native driver binding`);
  const streamMapping = settings.executionOptions?.stream_results;
  if (streamMapping && streamMapping.target !== 'stream_results') throw new TypeError('SQL transport stream_results mapping must retain its target');
  const executionOptions = { ...settings.executionOptions,
    stream_results: { target: 'stream_results', convert(value: unknown) {
      if (typeof value !== 'boolean' || streamMapping && streamMapping.convert(value) !== value) throw new CsvkitBlocked('SQL transport stream_results requires preserved Boolean identity');
      return value;
    } }
  };
  const diagnostic = settings.diagnostic;
  const translate = (error: unknown, sql: string | null, signal?: AbortSignal): never => {
    signal?.throwIfAborted();
    if (error instanceof CsvkitCleanupError) throw error;
    if (error instanceof CsvkitDiagnostic) throw error;
    if (diagnostic) throw diagnostic(error, sql);
    throw new CsvkitBlocked(`SQL transport ${profile.name} driver diagnostic profile`);
  };
  return createDatabaseProvider({ ...settings, executionOptions, schemes: profile.schemes, transport: 'network',
    async connect(request, signal): Promise<DatabaseSession> {
      let connection: SqlTransportConnection;
      try { connection = await open(request, signal); }
      catch (error) { return translate(error, null, signal); }
      const results = new Set<DatabaseResult>(), operations = new Set<Promise<unknown>>();
      let closed = false, closing: Promise<void> | undefined;
      const admitted = <T>(start: () => Promise<T>, activeSignal?: AbortSignal): Promise<T> => {
        activeSignal?.throwIfAborted();
        if (closed) throw new TypeError('SQL transport session closed');
        const pending = Promise.resolve().then(start);
        operations.add(pending);
        void pending.then(() => operations.delete(pending), () => operations.delete(pending));
        return pending;
      };
      const wrap = async (cursor: SqlTransportCursor, sql: string, activeSignal: AbortSignal): Promise<DatabaseResult> => {
        let columns: readonly string[] | null;
        try {
          const labels = cursor.columns;
          columns = labels === null ? null : Object.freeze([...labels]);
        } catch (error) {
          // The driver has transferred its cursor even if metadata access fails.
          // Keep both disposal stages inside the admitted acquisition operation.
          const failures: unknown[] = [error];
          try { await cursor.cancel(); } catch (cleanupError) { failures.push(cleanupError); }
          try { await cursor.close(); } catch (cleanupError) { failures.push(cleanupError); }
          if (failures.length > 1) throw new CsvkitCleanupError(failures, 'SQL transport cursor metadata cleanup failed');
          throw error;
        }
        let reading: Promise<readonly DatabaseCell[] | null> | undefined;
        let released = false, returning: Promise<void> | undefined, iterated = false;
        const close = (): Promise<void> => {
          released = true;
          activeSignal.removeEventListener('abort', onAbort);
          return returning ??= Promise.resolve().then(async () => {
            const failures: unknown[] = [];
            try { await cursor.cancel(); } catch (error) { failures.push(error); }
            await Promise.allSettled([reading]);
            try { await cursor.close(); } catch (error) { failures.push(error); }
            results.delete(result);
            if (failures.length) throw new CsvkitCleanupError(failures, 'SQL transport cursor cleanup failed');
          });
        };
        const onAbort = (): void => { void close().catch(() => {}); };
        const result: DatabaseResult = {
          columns, close,
          rows: { [Symbol.asyncIterator]() {
            if (iterated) throw new TypeError('SQL transport cursor already consumed');
            iterated = true;
            return {
              async next() {
                activeSignal.throwIfAborted();
                if (released) return { done: true as const, value: undefined };
                if (reading) throw new TypeError('concurrent SQL transport cursor reads');
                reading = Promise.resolve().then(() => cursor.read(activeSignal));
                let row: readonly DatabaseCell[] | null;
                try { row = await reading; } catch (error) { return translate(error, sql, activeSignal); }
                finally { reading = undefined; }
                activeSignal.throwIfAborted();
                if (released || row === null) return { done: true as const, value: undefined };
                return { done: false as const, value: Object.freeze(row.map(value => value instanceof Uint8Array ? Uint8Array.from(value) : value && typeof value === 'object' ? Object.freeze({ ...value }) : value)) };
              },
              async return() { await close(); return { done: true as const, value: undefined }; }
            };
          } }
        };
        results.add(result);
        if (activeSignal.aborted) onAbort();
        else activeSignal.addEventListener('abort', onAbort, { once: true });
        return result;
      };
      const query = async (sql: string, values: readonly SqlValue[], options: Readonly<Record<string, unknown>>, activeSignal: AbortSignal): Promise<DatabaseResult> => {
        const owned = values.map(value => value instanceof Uint8Array ? Uint8Array.from(value) : value && typeof value === 'object' ? Object.freeze({ ...value }) : value);
        try { return await admitted(async () => wrap(await connection.execute({ sql, values: owned, options, signal: activeSignal }), sql, activeSignal), activeSignal); }
        catch (error) { return translate(error, sql, activeSignal); }
      };
      const session: DatabaseSession = {
        profile: settings.profile, dialect: profile.dialect, sqlDialect, query,
        async begin(activeSignal) {
          try { await admitted(() => connection.transaction('begin', activeSignal), activeSignal); }
          catch (error) { return translate(error, null, activeSignal); }
        },
        async commit(activeSignal) {
          try { await admitted(() => connection.transaction('commit', activeSignal), activeSignal); }
          catch (error) { return translate(error, null, activeSignal); }
        },
        async rollback() {
          if (closed) return;
          try { await admitted(() => connection.transaction('rollback')); }
          catch (error) { return translate(error, null); }
        },
        async hasTable(name, schema, activeSignal) {
          const statement = profile.reflection(name, schema);
          const result = await admitted(async () => {
            let cursor: SqlTransportCursor;
            try { cursor = await connection.execute({ ...statement, options: {}, signal: activeSignal }); }
            catch (error) {
              activeSignal.throwIfAborted();
              if (profile.missingTable?.(error)) return null;
              return translate(error, statement.sql, activeSignal);
            }
            return wrap(cursor, statement.sql, activeSignal);
          }, activeSignal).catch(error => translate(error, statement.sql, activeSignal));
          if (result === null) return false;
          const iterator = result.rows[Symbol.asyncIterator]();
          try { return !(await iterator.next()).done; }
          finally { await iterator.return?.(); await result.close(); }
        },
        close() {
          closed = true;
          return closing ??= Promise.resolve().then(async () => {
            const failures: unknown[] = [];
            // Interrupt owned cursors first, then drain every admitted operation.
            const disposing = [...results].map(result => result.close());
            const settled = await Promise.allSettled([...disposing, ...operations]);
            for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
            for (const result of [...results]) try { await result.close(); } catch (error) { failures.push(error); }
            try { await connection.close(); } catch (error) { failures.push(error); }
            if (failures.length) throw new CsvkitCleanupError(failures, 'SQL transport connection cleanup failed');
          });
        },
        ...(connection.executeMany === undefined ? {} : {
          async executeMany(sql: string, rows: readonly (readonly SqlValue[])[], activeSignal: AbortSignal) {
            const owned = rows.map(row => row.map(value => value instanceof Uint8Array ? Uint8Array.from(value) : value && typeof value === 'object' ? Object.freeze({ ...value }) : value));
            try { return await admitted(async () => wrap(await connection.executeMany!({ sql, rows: owned, options: {}, signal: activeSignal }), sql, activeSignal), activeSignal); }
            catch (error) { return translate(error, sql, activeSignal); }
          }
        })
      };
      return session;
    }
  });
}
