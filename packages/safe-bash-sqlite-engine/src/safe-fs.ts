import { FsError, type FileSystem } from 'safe-bash-contracts';
import type { FileDescriptor } from '@poe-code/safe-fs/contracts';
import { readSqliteFile, writeSqliteFile } from './file-io.js';

export type SqliteFileSystem = Pick<FileSystem, 'open' | 'stat' | 'unlink'>;

/** Native SQLite callbacks for one connection in an exclusively owned private
 * directory. Pass a caller-confined filesystem: these callbacks do not lock or
 * modify canonical database paths. The transaction owns staging and publication.
 * Assign these async callbacks to the native engine's FacadeVFS instance. */
export function createSqliteVfs(options: {
  fs: SqliteFileSystem; directory: string; signal: AbortSignal;
  maxOpenFiles: number; maxFileBytes: number;
}) {
  const { fs, directory, signal, maxOpenFiles, maxFileBytes } = options;
  if (!fs.open || !fs.unlink) throw new FsError('ENOTSUP', { message: 'SQLite requires positioned file descriptors' });
  if (!directory.startsWith('/') || directory === '/' || directory.split('/').slice(1).some(part => !part || part === '.' || part === '..')) throw new RangeError('Invalid SQLite private directory');
  if (!Number.isSafeInteger(maxOpenFiles) || maxOpenFiles < 1 || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0) throw new RangeError('Invalid SQLite file limits');
  const open = fs.open.bind(fs), unlink = fs.unlink.bind(fs);
  type Entry = { file: FileDescriptor; name: string; remove: boolean };
  const handles = new Map<number, Entry>();
  const pending = new Set<Promise<number>>();
  const opening = new Map<number, string>();
  let disposal: Promise<void> | undefined;
  let failed = false, failure: unknown, disposed = false;
  const fail = (error: unknown): void => { if (!failed) { failed = true; failure = error; } };
  const admit = (): void => {
    if (disposed) throw new FsError('EBADF', { message: 'SQLite filesystem is disposed' });
    if (failed) throw failure;
    signal.throwIfAborted();
  };
  const filename = (name: string): string => {
    const prefix = directory + '/', leaf = name.slice(prefix.length);
    if (!name.startsWith(prefix) || !leaf || leaf.includes('/') || leaf.includes('\0') || leaf === '.' || leaf === '..') throw new FsError('EACCES', { path: name, message: 'SQLite file is outside its private directory' });
    return name;
  };
  const entry = (id: number): Entry => {
    const value = handles.get(id);
    if (!value) throw new FsError('EBADF', { message: 'Unknown SQLite file handle' });
    return value;
  };
  const offset = (value: number | bigint, length = 0): number => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || !Number.isSafeInteger(number + length)) throw new RangeError('Invalid native SQLite file range');
    return number;
  };
  const growth = (size: number): void => { if (size > maxFileBytes) throw new FsError('EFBIG', { message: 'SQLite private file exceeds its byte budget' }); };
  const remove = async (name: string): Promise<void> => {
    try { await unlink(name); } catch (error) { if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error; }
  };
  const close = async (value: Entry): Promise<void> => {
    const errors: unknown[] = [];
    try { await value.file.close(); } catch (error) { errors.push(error); }
    if (value.remove) try { await remove(value.name); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'SQLite file cleanup failed');
  };
  const execute = (operation: () => Promise<number>, errorCode = 10, releasing = false): Promise<number> => {
    const task = (async () => {
      try { if (!releasing) admit(); const result = await operation(); if (!releasing) admit(); return result; }
      catch (error) { fail(error); return errorCode; }
    })();
    pending.add(task);
    void task.finally(() => { pending.delete(task); });
    return task;
  };
  return {
    async jOpen(name: string | null, id: number, flags: number, out: DataView): Promise<number> {
      return execute(async () => {
        if (handles.has(id) || opening.has(id) || handles.size + opening.size >= maxOpenFiles) throw new FsError('EMFILE', { message: 'SQLite open file limit exceeded' });
        const temporary = name === null;
        const path = filename(name ?? `${directory}/sqlite-temp-${crypto.randomUUID()}`);
        if ([...opening.values()].includes(path) || [...handles.values()].some(value => value.name === path)) throw new FsError('EBUSY', { path, message: 'SQLite private files require a single connection' });
        opening.set(id, path);
        try {
          const file = await open(path, { access: flags & 1 ? 'read' : 'readwrite', creation: temporary || flags & 16 ? 'exclusive' : flags & 4 ? 'ifMissing' : 'never', noFollow: true, mode: 0o600, signal });
          const value = { file, name: path, remove: temporary || Boolean(flags & 8) };
          try {
            admit();
            if (!file.capabilities.positionedRead || (!(flags & 1) && (!file.capabilities.positionedWrite || !file.capabilities.truncate))) throw new FsError('ENOTSUP', { message: 'SQLite requires positioned descriptor IO' });
            const stat = await file.stat({ signal });
            if (stat.type !== 'file') throw new FsError('EINVAL', { path });
            growth(offset(stat.size)); admit();
            out.setInt32(0, flags, true); handles.set(id, value); return 0;
          } catch (error) {
            try { await close(value); } catch (cleanup) { throw new AggregateError([error, cleanup], 'SQLite open and cleanup failed'); }
            throw error;
          }
        } finally { opening.delete(id); }
      }, 14);
    },
    async jClose(id: number): Promise<number> {
      return execute(async () => { const value = entry(id); handles.delete(id); await close(value); return 0; }, 10, true);
    },
    async jRead(id: number, bytes: Uint8Array, position: number | bigint): Promise<number> {
      return execute(async () => await readSqliteFile(entry(id).file, bytes, offset(position, bytes.length), signal) ? 0 : 522);
    },
    async jWrite(id: number, bytes: Uint8Array, position: number | bigint): Promise<number> {
      return execute(async () => { const start = offset(position, bytes.length); growth(start + bytes.length); await writeSqliteFile(entry(id).file, bytes, start, signal); return 0; });
    },
    async jTruncate(id: number, size: number | bigint): Promise<number> {
      return execute(async () => { const length = offset(size); growth(length); await entry(id).file.truncate(length, { signal }); return 0; });
    },
    async jFileSize(id: number, out: DataView): Promise<number> {
      return execute(async () => { const stat = await entry(id).file.stat({ signal }); const size = offset(stat.size); growth(size); out.setBigInt64(0, BigInt(size), true); return 0; });
    },
    async jSync(id: number, _flags: number): Promise<number> {
      return execute(async () => { await entry(id).file.sync(false, { signal }); return 0; });
    },
    async jDelete(name: string, _syncDir?: number): Promise<number> {
      return execute(async () => { await unlink(filename(name), { signal }); return 0; });
    },
    async jAccess(name: string, _flags: number, out: DataView): Promise<number> {
      return execute(async () => {
        const path = filename(name);
        try { await fs.stat(path, { signal }); out.setInt32(0, 1, true); }
        catch (error) { if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error; out.setInt32(0, 0, true); }
        return 0;
      });
    },
    throwIfFailed(): void { if (failed) throw failure; },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
        await Promise.all(pending);
        const errors: unknown[] = [];
        for (const [id, value] of handles) {
          handles.delete(id);
          try { await close(value); } catch (error) { fail(error); errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'SQLite filesystem cleanup failed');
      })();
      return disposal;
    }
  };
}
