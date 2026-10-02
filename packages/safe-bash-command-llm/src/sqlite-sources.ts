import { FsError, type FileReadHandle, type FileStat, type FileSystem, type FileStagingResolution } from 'safe-bash-contracts';
import { verifySqliteSnapshot } from './sqlite-snapshot.js';

export interface SqliteSource {
  readonly stat: FileStat;
  readonly file: FileReadHandle;
}

export interface SqliteSources {
  readonly path: string;
  readonly parent: FileStat;
  readonly database: SqliteSource | null;
  readonly wal: SqliteSource | null;
  readonly journal: SqliteSource | null;
  readonly shm: SqliteSource | null;
  validate(): true;
  close(): Promise<void>;
}

/** Retain a coherent database and sidecar set through authoritative synchronous
 * resolution guards. Each read revalidates the complete set and returns at most
 * 16 KiB. Closing any member closes the set. No source payload is buffered here.
 * Hosts without synchronous binding guards must supply a stronger acquisition
 * implementation; sequential path stats are not a substitute. */
export async function acquireSqliteSources(fs: FileSystem, path: string, signal: AbortSignal): Promise<SqliteSources> {
  signal.throwIfAborted();
  const resolutions: FileStagingResolution[] = [];
  const handles: FileReadHandle[] = [];
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= Promise.allSettled(handles.map(handle => Promise.resolve().then(() => handle.close()))).then(results => {
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'SQLite source cleanup failed');
  });
  const validate = (): true => {
    if (closing) throw new FsError('EBADF', { path, message: 'SQLite source set is closed' });
    signal.throwIfAborted();
    for (const resolution of resolutions) {
      if (resolution.validate() !== true) throw new FsError('ENOTSUP', { path, message: 'SQLite source guards must validate synchronously' });
    }
    signal.throwIfAborted();
    return true;
  };
  const resolve = async (sourcePath: string): Promise<FileStagingResolution> => {
    const capabilities = await fs.capabilitiesFor?.(sourcePath, { signal, stagingResolution: true }) ?? fs.capabilities;
    if (capabilities.synchronousStagingResolution !== true || capabilities.retainedRead !== true || !fs.prepareStagingResolution || !fs.openReadFile) {
      throw new FsError('ENOTSUP', { path: sourcePath, message: 'SQLite source acquisition requires retained reads and synchronous binding guards' });
    }
    const resolution = await fs.prepareStagingResolution(sourcePath, { signal });
    resolutions.push(resolution);
    return resolution;
  };
  try {
    const database = await resolve(path);
    for (const suffix of ['wal', 'journal', 'shm']) await resolve(`${database.path}-${suffix}`);
    validate();
    const sources: (SqliteSource | null)[] = [];
    for (const resolution of resolutions) {
      if (resolution.destination === null) { sources.push(null); continue; }
      const expected = Object.freeze({ ...resolution.destination });
      verifySqliteSnapshot(expected, expected);
      const handle = await fs.openReadFile!(resolution.path, { signal });
      handles.push(handle);
      verifySqliteSnapshot(await handle.stat({ signal }), expected);
      validate();
      const controls = (operationSignal?: AbortSignal): { signal: AbortSignal } => ({ signal: operationSignal ? AbortSignal.any([signal, operationSignal]) : signal });
      const file: FileReadHandle = {
        async stat(options) {
          validate();
          const operation = controls(options?.signal);
          operation.signal.throwIfAborted();
          const stat = await handle.stat(operation);
          operation.signal.throwIfAborted();
          verifySqliteSnapshot(stat, expected);
          validate();
          return stat;
        },
        async read(position, maxBytes, options) {
          validate();
          if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid SQLite source read');
          const count = Math.min(maxBytes, 16384);
          const operation = controls(options?.signal);
          operation.signal.throwIfAborted();
          const bytes = await handle.read(position, count, operation);
          operation.signal.throwIfAborted();
          if (!(bytes instanceof Uint8Array) || bytes.length > count) throw new FsError('EIO', { path: resolution.path, message: 'Invalid SQLite source read' });
          const owned = bytes.slice();
          validate();
          return owned;
        },
        close,
      };
      sources.push({ stat: expected, file });
    }
    validate();
    return { path: database.path, parent: Object.freeze({ ...database.parent }), database: sources[0]!, wal: sources[1]!, journal: sources[2]!, shm: sources[3]!, validate, close };
  } catch (error) {
    try { await close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'SQLite source acquisition and cleanup failed'); }
    throw error;
  }
}
