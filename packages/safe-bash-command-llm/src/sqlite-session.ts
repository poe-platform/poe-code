import {FsError, type FileSystem} from 'safe-bash-contracts';
import type {SqliteRuntime} from 'safe-bash-sqlite-engine';
import {createSqliteVfs} from './sqlite-vfs.js';
import {withSqliteDatabase} from './sqlite-native.js';

export interface PrivateSqliteSession extends SqliteRuntime {
  readonly database: number;
  execute(sql: string): Promise<void>;
  check(): void;
}

/** Own the runtime, native connection and descriptors for one private storage
 * operation. The caller owns the private directory and canonical publication.
 * Serialize all native calls and keep session resources within the callback. */
export async function withPrivateSqliteSession<T>(options: {
  fs: FileSystem; directory: string; path: string; signal: AbortSignal;
  maxOpenFiles: number; maxFileBytes: number;
}, operation: (session: PrivateSqliteSession) => Promise<T>): Promise<T> {
  const {directory, path, signal} = options;
  signal.throwIfAborted();
  const leaf = path.slice(directory.length + 1);
  if (!path.startsWith(directory + '/') || !leaf || leaf === '.' || leaf === '..' || leaf.includes('/') || leaf.includes('\0')) {
    throw new FsError('EACCES', {path, message: 'SQLite session requires a private database path'});
  }
  const callbacks = createSqliteVfs(options);
  const errors: unknown[] = [];
  let value!: T;
  try {
    const {createSqliteRuntime, FacadeVFS} = await import('safe-bash-sqlite-engine');
    const runtime = await createSqliteRuntime({signal});
    const vfs = 'llm-private';
    const code = runtime.module.vfs_register(Object.assign(new FacadeVFS(vfs, runtime.module), callbacks), true);
    if (code !== 0) throw new FsError('EIO', {message: `SQLite VFS registration failed (${code})`});
    value = await withSqliteDatabase(runtime.module, {path, vfs, signal, check: callbacks.throwIfFailed}, connection =>
      operation({...runtime, ...connection, check: callbacks.throwIfFailed}));
  } catch (error) {errors.push(error);}
  try {await callbacks.dispose();} catch (error) {if (!errors.includes(error)) errors.push(error);}
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'SQLite session and descriptor cleanup failed');
  return value;
}
