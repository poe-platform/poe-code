import { nativeScalarValue } from '../sql-transport-values.js';
import { mariadb } from './mariadb.js';
import type { SqlTransportProfile } from './descriptor.js';
import type { NativeMariaConnection } from '../sql-native.js';
import { nativeParameters, nativeWork, nativeBufferedCursor, nativeExecutionOptions } from '../sql-native.js';
import { CsvkitBlocked } from '../errors.js';
export const mariadb_mariadb: SqlTransportProfile = {
  ...mariadb, name: 'mariadb-node-v1',
  bindValue: value => nativeScalarValue(value, mariadb.bindValue),
  async open(driver, request, signal) {
    const client = await driver.acquire(request, signal) as NativeMariaConnection;
    const transactions = { begin: () => client.beginTransaction(), commit: () => client.commit(), rollback: () => client.rollback() };
    return {
      async execute(statement) {
        nativeExecutionOptions(statement.options, statement.options.stream_results === true);
        const values = nativeParameters(driver, statement.values);
        if (statement.options.stream_results === true) {
          if (!driver.cursor) throw new CsvkitBlocked('MariaDB explicit server cursor binding');
          return driver.cursor(client, statement.sql, values, statement.options, statement.signal);
        }
        const [rows, fields] = await nativeWork(driver, client, statement.signal, () => client.query({ sql: statement.sql, rowsAsArray: true, metaAsArray: true }, values));
        return nativeBufferedCursor(driver, fields?.map(field => field.name) ?? null, rows, fields);
      },
      async transaction(operation, activeSignal) { await nativeWork(driver, client, activeSignal, transactions[operation]); },
      close: () => driver.release(client)
    };
  }
};
