import { compareIdentity, retainFileSystemCleanup } from '@poe-code/safe-fs/core';
import { FsError, type FileStat, type FileStaging, type FileSystem, type FsOptions } from 'safe-bash-contracts';
import type { FileDescriptor, OpenFileOptions } from '@poe-code/safe-fs/contracts';
import type { SqliteFileSystem } from './sqlite-vfs.js';

/** Own mutable native scratch files separately from canonical database paths.
 * Creation records inode ownership atomically; deletion compares a fresh version
 * of that same owned inode. Retained cleanup outlives the command's signal. */
export async function createPrivateSqliteStorage(options: {
  fs: FileSystem; directory: string; signal: AbortSignal; maxFiles: number;
}): Promise<{ directory: string; fs: SqliteFileSystem; close(): Promise<void> }> {
  const { fs, directory, signal, maxFiles } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new RangeError('Invalid SQLite private file count');
  if (!directory.startsWith('/') || directory !== '/' && directory.slice(1).split('/').some(part => !part || part === '.' || part === '..')) throw new RangeError('Invalid SQLite storage directory');
  const capabilities = await fs.capabilitiesFor?.(directory, { signal }) ?? fs.capabilities;
  if (!capabilities.atomicFileMutation || !capabilities.retainedStagingCleanup || !fs.createStagedFile || !fs.writeFileConditional || !fs.removeFileConditional || !fs.open) {
    throw new FsError('ENOTSUP', { path: directory, message: 'SQLite private storage requires conditional file ownership and retained cleanup' });
  }
  const parent = await fs.lstat(directory, { signal });
  const owners = new Map<string, FileStat>();
  const opening = new Set<string>();
  const pending = new Set<Promise<FileDescriptor>>();
  const descriptors = new Set<() => Promise<void>>();
  let staging: FileStaging | undefined;
  let closing: Promise<void> | undefined;
  const lifetime = new AbortController();
  const cleanupFiles = retainFileSystemCleanup(fs, async view => {
    const errors: unknown[] = [];
    for (const [path, expected] of owners) {
      try {
        const current = await view.lstat(path);
        if (compareIdentity(current, expected) !== 'same') throw new FsError('EAGAIN', { path, message: 'SQLite private file was replaced' });
        if (!view.removeFileConditional) throw new FsError('ENOTSUP', { path });
        await view.removeFileConditional(path, { parent: staging!.directory.stat, expected: current });
        owners.delete(path);
      } catch (error) {
        if (error instanceof FsError && error.code === 'ENOENT') owners.delete(path);
        else errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'SQLite private file cleanup failed');
  });
  const close = (): Promise<void> => closing ??= (async () => {
    lifetime.abort(new FsError('EBADF', { message: 'SQLite private storage is closing' }));
    await Promise.allSettled(pending);
    const results = await Promise.allSettled([...descriptors].map(dispose => dispose()));
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    try { await cleanupFiles(); } catch (error) { errors.push(error); }
    try { await staging?.cleanup?.remove(); } catch (error) { errors.push(error); }
    try { await staging?.cleanup?.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'SQLite private storage cleanup failed');
  })();
  try {
    staging = await fs.createStagedFile(`${directory === '/' ? '' : directory}/.llm-sqlite-${crypto.randomUUID()}`, '.owner',
      { type: 'file', data: new Uint8Array() }, { parent, mode: 0o600, retainCleanup: true, signal });
    if (!staging.cleanup) throw new FsError('EIO', { message: 'SQLite private storage omitted retained cleanup' });
    signal.throwIfAborted();
    const owner = staging;
    const controls = (settings: FsOptions = {}): FsOptions => {
      if (closing) throw new FsError('EBADF', { message: 'SQLite private storage is closed' });
      signal.throwIfAborted(); lifetime.signal.throwIfAborted(); settings.signal?.throwIfAborted();
      return { signal: AbortSignal.any([signal, lifetime.signal, ...(settings.signal ? [settings.signal] : [])]) };
    };
    const filename = (path: string): void => {
      const prefix = owner.directory.path + '/', leaf = path.slice(prefix.length);
      if (!path.startsWith(prefix) || !leaf || leaf === '.' || leaf === '..' || leaf === '.owner' || leaf.includes('/') || leaf.includes('\0')) {
        throw new FsError('EACCES', { path, message: 'SQLite file is outside its owned private namespace' });
      }
    };
    const inspect = async (path: string, settings: FsOptions): Promise<FileStat> => {
      filename(path);
      const actual = await fs.lstat(path, settings);
      const expected = owners.get(path);
      if (!expected || compareIdentity(actual, expected) !== 'same') throw new FsError('EAGAIN', { path, message: 'SQLite private file was replaced' });
      return actual;
    };
    const open = (path: string, settings: OpenFileOptions): Promise<FileDescriptor> => {
      const task = (async () => {
        const operation = controls(settings); filename(path);
        if (opening.has(path)) throw new FsError('EBUSY', { path });
        if (!owners.has(path) && new Set([...owners.keys(), ...opening]).size >= maxFiles) throw new FsError('EMFILE', { path });
        opening.add(path);
        let descriptor: FileDescriptor | undefined;
        try {
          if (!owners.has(path) && settings.creation !== 'never') {
            const created = await fs.writeFileConditional!(path, new Uint8Array(), { parent: owner.directory.stat, expected: null, mode: 0o600, ...operation });
            owners.set(path, created);
          } else {
            await inspect(path, operation);
            if (settings.creation === 'exclusive') throw new FsError('EEXIST', { path });
          }
          controls(operation);
          descriptor = await fs.open!(path, { ...settings, creation: 'never', truncate: false, noFollow: true, ...operation });
          const expected = owners.get(path)!;
          if (compareIdentity(await descriptor.stat(operation), expected) !== 'same') throw new FsError('EAGAIN', { path });
          controls(operation);
          if (settings.truncate) await descriptor.truncate(0, operation);
          const handle = descriptor;
          let disposal: Promise<void> | undefined;
          const dispose = (settings?: FsOptions): Promise<void> => disposal ??= Promise.resolve().then(() => handle.close(settings)).finally(() => { descriptors.delete(dispose); });
          descriptors.add(dispose);
          return {
            capabilities: handle.capabilities,
            ...(handle.getPosition ? { getPosition: handle.getPosition.bind(handle) } : {}),
            ...(handle.probeRead ? { probeRead: handle.probeRead.bind(handle) } : {}),
            stat: handle.stat.bind(handle), read: handle.read.bind(handle), write: handle.write.bind(handle),
            truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle), close: dispose,
          };
        } catch (error) {
          if (descriptor) try { await descriptor.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'SQLite open and cleanup failed'); }
          throw error;
        } finally { opening.delete(path); }
      })();
      pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    };
    return {
      directory: owner.directory.path,
      fs: {
        open,
        stat: (path, settings) => inspect(path, controls(settings)),
        async unlink(path, settings) {
          const operation = controls(settings);
          const expected = await inspect(path, operation);
          await fs.removeFileConditional!(path, { parent: owner.directory.stat, expected, ...operation });
          owners.delete(path);
        },
      },
      close,
    };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'SQLite private storage admission and cleanup failed'); }
    throw error;
  }
}
