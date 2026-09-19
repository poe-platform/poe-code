import { nativeScalarValue } from '../sql-transport-values.js';
import { oracle } from './oracle.js';
import type { SqlTransportProfile } from './descriptor.js';
import type { NativeOracleConnection } from '../sql-native.js';
import { nativeParameters, nativeCell, nativeWork, nativeExecutionOptions } from '../sql-native.js';
export const oracle_oracledb: SqlTransportProfile = {
  ...oracle, name: 'oracle-oracledb-v1',
  bindValue: value => nativeScalarValue(value, oracle.bindValue),
  async open(driver, request, signal) {
    const client = await driver.acquire(request, signal) as NativeOracleConnection;
    let transaction = false;
    return {
      async execute(statement) {
        nativeExecutionOptions(statement.options);
        const result = await nativeWork(driver, client, statement.signal, () => client.execute(statement.sql, nativeParameters(driver, statement.values), { outFormat: 4001, resultSet: true, autoCommit: false }));
        let closed = false;
        return {
          get columns() { return result.metaData?.map(field => field.name) ?? null; },
          async read(activeSignal) {
            activeSignal.throwIfAborted();
            if (closed || !result.resultSet) return null;
            const row = await result.resultSet.getRow();
            return row?.map((value, column) => nativeCell(driver, value, column, result.metaData?.[column])) ?? null;
          },
          async cancel() { if (driver.cancel) await driver.cancel(client); },
          async close() { if (!closed) { closed = true; await result.resultSet?.close(); } }
        };
      },
      async transaction(operation, activeSignal) {
        activeSignal?.throwIfAborted();
        if (operation === 'begin') { if (transaction) throw new TypeError('Oracle transaction already begun'); transaction = true; return; }
        const operations = { commit: () => client.commit(), rollback: () => client.rollback() };
        await nativeWork(driver, client, activeSignal, operations[operation]); transaction = false;
      },
      close: () => driver.release(client)
    };
  }
};
