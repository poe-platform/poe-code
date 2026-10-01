import type { FileReadHandle } from 'safe-bash-contracts';
import { findSqliteRecord, type SqliteRecordSource } from './sqlite-pages.js';
import { verifySqliteSnapshot } from './sqlite-snapshot.js';

/** Walk a rowid table with bounded btree seeks rather than retaining its rows.
 * The caller owns the retained file; all rows belong to the initial revision. */
export async function* scanSqliteRecords(file: FileReadHandle, rootPage: number, signal: AbortSignal): AsyncIterable<SqliteRecordSource & { readonly rowid: bigint }> {
  signal.throwIfAborted();
  const snapshot = await file.stat({ signal });
  verifySqliteSnapshot(snapshot, snapshot);
  let next = -(1n << 63n);
  while (next < 1n << 63n) {
    signal.throwIfAborted();
    verifySqliteSnapshot(await file.stat({ signal }), snapshot);
    const record = await findSqliteRecord(file, rootPage, next, signal, 'at-or-after');
    verifySqliteSnapshot(await file.stat({ signal }), snapshot);
    if (!record) return;
    yield record;
    next = record.rowid + 1n;
  }
}
