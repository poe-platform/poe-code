import { mssql } from './mssql.js';
import { nativeScalarValue } from '../sql-transport-values.js';
import type { SqlTransportProfile } from './descriptor.js';
import { nativeParameters, nativeWork, nativeBufferedCursor, nativeExecutionOptions } from '../sql-native.js';
import { CsvkitBlocked, CsvkitCleanupError } from '../errors.js';
export const mssql_mssql: SqlTransportProfile = {
  ...mssql, name: 'mssql-node-v1',
  bindValue: value => value && typeof value === 'object' && value.kind === 'date'
    ? Object.freeze({ kind: 'datetime', value: value.value + 'T00:00:00' })
    : nativeScalarValue(value, mssql.bindValue),
  async open(driver, request, signal) {
    if (!driver.transaction || !driver.request) throw new CsvkitBlocked('MSSQL explicit transaction/request binding');
    const client = await driver.acquire(request, signal);
    let transaction;
    try { transaction = driver.transaction(client); } catch (error) {
      try { await driver.release(client); }
      catch (cleanupError) { throw new CsvkitCleanupError([error, cleanupError], 'MSSQL transaction acquisition cleanup failed'); }
      throw error;
    }
    const transactions = { begin: () => transaction.begin(), commit: () => transaction.commit(), rollback: () => transaction.rollback() };
    return {
      async execute(statement) {
        nativeExecutionOptions(statement.options, statement.options.stream_results === true);
        const values = nativeParameters(driver, statement.values);
        if (statement.options.stream_results === true) {
          if (!driver.cursor) throw new CsvkitBlocked('MSSQL explicit server cursor binding');
          return driver.cursor(transaction, statement.sql, values, statement.options, statement.signal);
        }
        const query = driver.request!(transaction);
        query.arrayRowMode = true;
        values.forEach((value, index) => query.input('p' + (index + 1), value));
        const cancel = (): void => {
          // Abort listeners must not raise an uncaught host exception. The
          // admitted query still drains; the caller's abort remains authoritative.
          try { query.cancel(); } catch { /* Request interruption is best effort. */ }
        };
        statement.signal.throwIfAborted();
        statement.signal.addEventListener('abort', cancel, { once: true });
        try {
          const result = await query.query(statement.sql);
          return nativeBufferedCursor(driver, result.recordset?.columns?.map(field => field.name) ?? null, result.recordset ?? [], result.recordset?.columns);
        } finally { statement.signal.removeEventListener('abort', cancel); }
      },
      async transaction(operation, activeSignal) { await nativeWork(driver, client, activeSignal, transactions[operation]); },
      close: () => driver.release(client)
    };
  }
};
