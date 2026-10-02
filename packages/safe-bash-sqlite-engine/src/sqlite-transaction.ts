import { FsError, toByteSource, type FileReadHandle, type FileStat, type FileSystem } from 'safe-bash-contracts';
import { acquireSqliteSources } from './sqlite-sources.js';
import { createPrivateSqliteStorage } from './sqlite-private.js';
import { withPrivateSqliteSession, type PrivateSqliteSession } from './sqlite-session.js';
import { createSqliteWalSnapshot } from './sqlite-wal.js';
import { writeSqliteFile } from './file-io.js';
import { finalizeSqlite, type SqliteFinalizer } from './sqlite-finalization.js';
import { publishSqliteSnapshot } from './sqlite-publication.js';

/** Run native SQL against an owned private copy, then atomically replace the
 * acquired canonical source set. A committed receipt survives cleanup errors:
 * callers must never retry a committed operation because retirement failed. */
export async function transactSqlite<T>(options: {
  fs: FileSystem; path: string; signal: AbortSignal;
  maxFileBytes: number; maxIndexBytes: number; maxOpenFiles: number;
  /** Runs after native COMMIT and connection closure, before publication.
   * Phases are serialized and failures poison publication. Indexes and constraints
   * affected by record rewrites remain the operation's responsibility. */
  finalize?: (editor: SqliteFinalizer) => Promise<void>;
}, operation: (session: PrivateSqliteSession) => Promise<T>): Promise<{
  value: T; committed: FileStat; cleanupErrors: readonly unknown[];
}> {
  const { fs, signal, maxFileBytes, finalize } = options;
  for (const limit of [maxFileBytes, options.maxIndexBytes, options.maxOpenFiles]) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid SQLite transaction budget');
  }
  const cleanups: (() => Promise<void>)[] = [];
  let committed: FileStat | undefined;
  let value!: T;
  let failure: unknown;
  let failed = false;
  try {
    const sources = await acquireSqliteSources(fs, options.path, signal);
    cleanups.push(() => sources.close());
    const path = sources.path;
    const directory = path.slice(0, path.lastIndexOf('/')) || '/';
    if (!fs.createStagedFile || !fs.publishStagedFileSet) throw new FsError('ENOTSUP', { path, message: 'SQLite transactions require retained source-set publication' });
    const storage = await createPrivateSqliteStorage({ fs, directory, signal, maxFiles: options.maxOpenFiles });
    cleanups.push(() => storage.close());
    const privatePath = `${storage.directory}/database`;
    const copy = async (source: FileReadHandle, target: string): Promise<void> => {
      const stat = await source.stat({ signal });
      if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maxFileBytes) throw new FsError('EFBIG', { path: target });
      const file = await storage.fs.open!(target, { access: 'readwrite', creation: 'exclusive', signal });
      try {
        for (let position = 0; position < stat.size;) {
          const bytes = await source.read(position, Math.min(16384, stat.size - position), { signal });
          if (!bytes.length || bytes.length > Math.min(16384, stat.size - position)) throw new FsError('EIO', { path: target });
          await writeSqliteFile(file, bytes, position, signal);
          position += bytes.length;
        }
      } finally { await file.close(); }
    };
    let snapshot = sources.database?.file;
    if (snapshot && sources.wal?.stat.size) {
      const index = await storage.fs.open!(`${storage.directory}/index`, { access: 'readwrite', creation: 'exclusive', signal });
      cleanups.push(() => index.close());
      snapshot = await createSqliteWalSnapshot(snapshot, sources.wal.file, index, { signal, maxIndexBytes: options.maxIndexBytes });
      const overlay = snapshot;
      cleanups.push(() => overlay.close());
    }
    if (!snapshot && (sources.wal?.stat.size || sources.journal?.stat.size)) throw new FsError('EIO', { path, message: 'SQLite sidecar has no database' });
    let walMode = false;
    if (snapshot) {
      await copy(snapshot, privatePath);
      const file = await storage.fs.open!(privatePath, { access: 'readwrite', creation: 'never', signal });
      try {
        const header = new Uint8Array(20);
        let count = 0;
        while (count < header.length) {
          const read = await file.read(header.subarray(count), count, { signal });
          if (!read) break;
          count += read;
        }
        walMode = count === 20 && header[18] === 2 && header[19] === 2;
        if (walMode) await writeSqliteFile(file, new Uint8Array([1, 1]), 18, signal);
      } finally { await file.close(); }
    }
    if (sources.journal?.stat.size) {
      if (walMode) throw new FsError('EIO', { path, message: 'SQLite WAL database has a rollback journal' });
      await copy(sources.journal.file, `${privatePath}-journal`);
    }
    value = await withPrivateSqliteSession({ ...options, fs: storage.fs, directory: storage.directory, path: privatePath }, async session => {
      await session.execute('BEGIN IMMEDIATE');
      const result = await operation(session);
      await session.execute('COMMIT');
      session.check();
      return result;
    });
    if (finalize) await finalizeSqlite({...options,fs:storage.fs,directory:storage.directory,path:privatePath},finalize);
    signal.throwIfAborted();
    sources.validate();
    const file = await storage.fs.open!(privatePath, { access: 'read', creation: 'never', signal });
    cleanups.push(() => file.close());
    const finalSnapshot: FileReadHandle = {
      stat: controls => file.stat(controls),
      async read(position, length, controls) {
        const bytes = new Uint8Array(Math.min(length, 16384));
        const count = await file.read(bytes, position, controls);
        return bytes.slice(0, count);
      },
      close: () => file.close(),
    };
    const staging = await fs.createStagedFile(`${directory === '/' ? '' : directory}/.sqlite-${crypto.randomUUID()}`, 'database',
      { type: 'file', data: new Uint8Array() }, { parent: sources.parent, retainCleanup: true, signal });
    if (staging.cleanup) {
      cleanups.push(() => staging.cleanup!.close());
      cleanups.push(() => staging.cleanup!.remove());
    } else {
      throw new FsError('EIO', { path, message: 'SQLite publication staging omitted retained cleanup' });
    }
    committed = await publishSqliteSnapshot({ fs, path, signal, parent: sources.parent, expected: sources.database?.stat ?? null,
      snapshot: finalSnapshot,
      patches: walMode ? [{ offset: 18, length: 2, bytes: toByteSource(new Uint8Array([2, 2])) }] : [],
      sourceSet: { staging, wal: sources.wal?.stat ?? null, journal: sources.journal?.stat ?? null, shm: sources.shm?.stat ?? null },
    });
  } catch (error) { failed = true; failure = error; }
  const cleanupErrors: unknown[] = [];
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch (error) { cleanupErrors.push(error); }
  }
  if (committed) return { value, committed, cleanupErrors };
  if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'SQLite transaction and cleanup failed');
  throw failure;
}
