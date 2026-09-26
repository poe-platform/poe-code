import type { DatabaseCell, SqlValue } from './contracts.js';
import type { DatabaseConnectionRequest } from './database-provider.js';
import type { SqlTransportCursor } from './sql-transport.js';
import { CsvkitBlocked } from './errors.js';

/** Explicit native infrastructure, supplied by the authorized host, never loaded here. */
export interface SqlNativeDriver {
  acquire(request: DatabaseConnectionRequest, signal: AbortSignal): Promise<object>;
  release(connection: object): Promise<void>;
  /** Interrupt the currently owned native operation without granting ambient authority. */
  cancel?(connection: object): Promise<void>;
  /** Server cursor binding, required where the native driver's promise API buffers rows. */
  cursor?(connection: object, sql: string, values: readonly unknown[], options: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<SqlTransportCursor>;
  /** Independently qualified codecs preserve deployment-specific scalar identities. */
  encode?(value: SqlValue): unknown;
  decode?(value: unknown, column: number, metadata?: unknown): DatabaseCell;
  transaction?(connection: object): NativeMssqlTransaction;
  request?(transaction: NativeMssqlTransaction): NativeMssqlRequest;
}
export interface NativePostgresConnection {
  query(query: string | { readonly text: string; readonly values: readonly unknown[]; readonly rowMode: 'array' }): Promise<{ readonly fields: readonly { readonly name: string }[]; readonly rows: readonly (readonly unknown[])[] }>;
}
export interface NativeMysqlConnection {
  execute(options: { readonly sql: string; readonly rowsAsArray: true }, values: readonly unknown[]): Promise<readonly [unknown, readonly { readonly name: string }[] | undefined]>;
  beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>;
}
export interface NativeMariaConnection {
  query(options: { readonly sql: string; readonly rowsAsArray: true; readonly metaAsArray: true }, values: readonly unknown[]): Promise<readonly [unknown, readonly { readonly name: string }[] | undefined]>;
  beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>;
}
export interface NativeOracleConnection {
  execute(sql: string, values: readonly unknown[], options: { readonly outFormat: 4001; readonly resultSet: true; readonly autoCommit: false }): Promise<{ readonly metaData?: readonly { readonly name: string }[]; readonly resultSet?: { getRow(): Promise<readonly unknown[] | undefined>; close(): Promise<void> } }>;
  commit(): Promise<void>; rollback(): Promise<void>;
}
export interface NativeMssqlTransaction {
  begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>;
}
export interface NativeMssqlRequest {
  arrayRowMode: boolean;
  input(name: string, value: unknown): NativeMssqlRequest;
  query(sql: string): Promise<{ readonly recordset?: readonly (readonly unknown[])[] & { readonly columns?: readonly { readonly name: string }[] } }>;
  cancel(): void;
}

export function nativeParameters(driver: SqlNativeDriver, values: readonly SqlValue[]): readonly unknown[] {
  return values.map(value => {
    if (driver.encode) return driver.encode(value);
    if (value && typeof value === 'object' && !(value instanceof Uint8Array)) throw new CsvkitBlocked('native SQL exact scalar binding codec');
    return value;
  });
}
export function nativeExecutionOptions(options: Readonly<Record<string, unknown>>, hostCursor = false): void {
  if (options.no_parameters === false) throw new CsvkitBlocked('native SQL DBAPI parameter interpolation profile');
  if (!hostCursor) for (const name of Object.keys(options)) {
    if (!['no_parameters', 'stream_results'].includes(name)) throw new CsvkitBlocked(`native SQL execution option ${name}`);
  }
}
export function nativeCell(driver: SqlNativeDriver, value: unknown, column: number, metadata?: unknown): DatabaseCell {
  if (driver.decode) return driver.decode(value, column, metadata);
  if (typeof value === 'number') throw new CsvkitBlocked('native SQL numeric result scalar codec');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new CsvkitBlocked('native SQL result scalar codec');
}
/** Cancellation cannot preempt an uncooperative driver; admitted work is drained. */
export async function nativeWork<T>(driver: SqlNativeDriver, connection: object, signal: AbortSignal | undefined, start: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  let cancellation: Promise<void> | undefined;
  const abort = (): void => { if (driver.cancel) { cancellation ??= Promise.resolve().then(() => driver.cancel!(connection)); void cancellation.catch(() => {}); } };
  signal?.addEventListener('abort', abort, { once: true });
  try { return await start(); }
  finally { signal?.removeEventListener('abort', abort); if (cancellation) await cancellation.catch(() => {}); }
}
export function nativeBufferedCursor(driver: SqlNativeDriver, columns: readonly string[] | null, rows: unknown, metadata?: readonly unknown[]): SqlTransportCursor {
  if (columns !== null && !Array.isArray(rows)) throw new CsvkitBlocked('native SQL array row mode');
  let index = 0, closed = false;
  return { columns,
    async read(signal) {
      signal.throwIfAborted();
      if (closed || columns === null || index >= (rows as unknown[]).length) return null;
      const row: unknown = (rows as unknown[])[index++];
      if (!Array.isArray(row)) throw new CsvkitBlocked('native SQL array row mode');
      return row.map((value, column) => nativeCell(driver, value, column, metadata?.[column]));
    },
    async cancel() { closed = true; }, async close() { closed = true; }
  };
}
