import { nativeScalarValue } from '../sql-transport-values.js';
import { postgresql } from './postgresql.js';
import type { SqlTransportProfile } from './descriptor.js';
import type { NativePostgresConnection } from '../sql-native.js';
import { nativeParameters, nativeWork, nativeExecutionOptions } from '../sql-native.js';
import { CsvkitBlocked } from '../errors.js';
export const postgresql_pg: SqlTransportProfile = {
  ...postgresql, name: 'postgresql-pg-cursor-v1',
  bindValue: value => nativeScalarValue(value, postgresql.bindValue),
  async open(driver, request, signal) {
    if (!driver.cursor) throw new CsvkitBlocked('PostgreSQL explicit server cursor binding');
    const client = await driver.acquire(request, signal) as NativePostgresConnection;
    return {
      async execute(statement) {
        nativeExecutionOptions(statement.options, true);
        return driver.cursor!(client, statement.sql, nativeParameters(driver, statement.values), statement.options, statement.signal);
      },
      async transaction(operation, activeSignal) { await nativeWork(driver, client, activeSignal, () => client.query(operation.toUpperCase())); },
      close: () => driver.release(client)
    };
  }
};
