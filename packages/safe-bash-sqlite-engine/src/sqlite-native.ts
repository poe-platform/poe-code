import { FsError } from 'safe-bash-contracts';
import type { SqliteBlobModule } from './sqlite-blob.js';

/** Own a single connection on an already registered private VFS. The caller
 * owns the module, VFS, private files and canonical publication. SQL is bounded
 * control text; large field values must use the incremental blob writer.
 * No connection or statement may escape the operation's lifetime. */
export async function withSqliteDatabase<T>(module: SqliteBlobModule, options: {
  path: string; vfs: string; signal: AbortSignal; check: () => void;
}, operation: (connection: { database: number; execute(sql: string): Promise<void> }) => Promise<T>): Promise<T> {
  const { path, vfs, signal, check } = options;
  signal.throwIfAborted();
  if (!path || !vfs || path.includes('\0') || vfs.includes('\0')) throw new TypeError('Invalid native SQLite filename');
  const open = module.cwrap('sqlite3_open_v2', 'number', ['string', 'number', 'number', 'string'], { async: true }) as
    (path: string, out: number, flags: number, vfs: string) => Promise<number>;
  const exec = module.cwrap('sqlite3_exec', 'number', ['number', 'string', 'number', 'number', 'number'], { async: true }) as
    (database: number, sql: string, callback: number, context: number, error: number) => Promise<number>;
  const close = module.cwrap('sqlite3_close', 'number', ['number'], { async: true }) as (database: number) => Promise<number>;
  const result = (code: number): void => {
    check();
    if (code !== 0) throw new FsError('EIO', { path, message: `Native SQLite operation failed (${code})` });
  };
  let pointer = 0, database = 0, accepting = true;
  let pending: Promise<void> | undefined;
  let failed = false, failure: unknown;
  const errors: unknown[] = [];
  let value!: T;
  const execute = (sql: string): Promise<void> => {
    const task = (async () => {
      if (!accepting) throw new FsError('EBADF', { message: 'SQLite connection is closed' });
      if (pending) throw new FsError('EBUSY', { message: 'Native SQLite calls must be serialized' });
      signal.throwIfAborted(); check();
      if (sql.includes('\0') || sql.length > 65536 || new TextEncoder().encode(sql).length > 65536) throw new RangeError('SQLite control statement exceeds its byte budget or contains NUL');
      result(await exec(database, sql, 0, 0, 0)); signal.throwIfAborted();
    })();
    // Keep the admitted operation visible until native Asyncify has unwound.
    if (!pending) {
      pending = task;
      void task.then(() => { pending = undefined; }, error => { pending = undefined; failed = true; failure = error; });
    } else {
      void task.catch(error => { failed = true; failure = error; });
    }
    return task;
  };
  try {
    check();
    pointer = module._malloc(4);
    if (!pointer) throw new RangeError('SQLite memory allocation failed');
    new DataView(module.HEAPU8.buffer).setInt32(pointer, 0, true);
    const code = await open(path, pointer, 6, vfs);
    database = new DataView(module.HEAPU8.buffer).getInt32(pointer, true);
    result(code); signal.throwIfAborted();
    if (!database) throw new FsError('EIO', { message: 'SQLite returned an empty connection' });
    await execute('PRAGMA cache_size=-512; PRAGMA temp_store=FILE; PRAGMA journal_mode=DELETE; PRAGMA mmap_size=0;');
    value = await operation({ database, execute });
  } catch (error) { errors.push(error); }
  accepting = false;
  if (pending) try { await pending; } catch (error) { if (!errors.includes(error)) errors.push(error); }
  if (failed && !errors.includes(failure)) errors.push(failure);
  // An open callback may acquire a handle before throwing across the native ABI.
  if (!database && pointer) database = new DataView(module.HEAPU8.buffer).getInt32(pointer, true);
  if (database) try {
    const code = await close(database);
    if (code !== 0) throw new FsError('EIO', { message: `Native SQLite close failed (${code})` });
  } catch (error) { errors.push(error); }
  if (pointer) try { module._free(pointer); } catch (error) { errors.push(error); }
  if (!errors.length) try { check(); signal.throwIfAborted(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'SQLite operation and cleanup failed');
  return value;
}
