import type { SQLiteFileSystem, SQLiteFile } from './sqlite-vfs.js';
import { CsvkitBlocked } from './errors.js';
import { virtualPath } from './io/index.js';

/** Minimal synchronous memfs surface; intentionally excludes Node filesystem access. */
export interface SQLiteMemoryVolume {
  openSync(path: string, flags: string): number;
  closeSync(fd: number): void;
  readSync(fd: number, bytes: Uint8Array, offset: number, length: number, position: number): number;
  writeSync(fd: number, bytes: Uint8Array, offset: number, length: number, position: number): number;
  ftruncateSync(fd: number, size: number): void;
  fstatSync(fd: number): { size: number | bigint };
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
  lstatSync(path: string): { isSymbolicLink(): boolean };
}

/** In-process memfs persistence and lock coordination, never host disk durability.
 * All connections to a volume must share this single adapter for lock safety. */
export function createMemorySqliteFileSystem(volume: SQLiteMemoryVolume, options: { authorize(path: string): boolean; maxBytes: number }): SQLiteFileSystem {
  if (options.maxBytes !== Infinity && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)) throw new TypeError('SQLite memory maxBytes must be a positive safe integer or Infinity');
  const locks = new Map<string, Map<object, number>>();
  let retained = 0;
  const sizes = new Map<string, number>();
  const admit = (path: string): void => {
    if (!path.startsWith('/') || virtualPath('/', path) !== path || !options.authorize(path)) throw new CsvkitBlocked('SQLite host divergence: unauthorized memory VFS path');
    let current = '';
    for (const segment of path.slice(1).split('/')) {
      current += '/' + segment;
      let stat: ReturnType<SQLiteMemoryVolume['lstatSync']>;
      try { stat = volume.lstatSync(current); }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue; throw error; }
      if (stat.isSymbolicLink()) throw new CsvkitBlocked('SQLite host divergence: symbolic link path');
    }
  };
  const account = (path: string, size: number): void => {
    const next = retained - (sizes.get(path) ?? 0) + size;
    if (next > options.maxBytes) throw new CsvkitBlocked('SQLite memory file byte budget exceeded');
    retained = next; sizes.set(path, size);
  };
  return {
    open(path, flags): SQLiteFile {
      admit(path);
      const exists = volume.existsSync(path), create = !!(flags & 4), readonly = !!(flags & 1);
      if (!exists && !create) throw new Error('SQLite memory file does not exist');
      if (exists && create && (flags & 16)) throw new Error('SQLite exclusive creation failed');
      const fd = volume.openSync(path, readonly ? 'r' : exists ? 'r+' : 'w+');
      try { account(path, Number(volume.fstatSync(fd).size)); }
      catch (error) { volume.closeSync(fd); throw error; }
      const identity = {}, holders = locks.get(path) ?? new Map<object, number>();
      locks.set(path, holders); holders.set(identity, 0);
      let closed = false;
      const writable = (): void => { if (readonly || closed) throw new Error('SQLite memory file not writable'); };
      return {
        read: (target, offset) => volume.readSync(fd, target, 0, target.byteLength, offset),
        write(source, offset) {
          writable();
          const size = Number(volume.fstatSync(fd).size), next = Math.max(size, offset + source.byteLength);
          account(path, next);
          try { if (volume.writeSync(fd, source, 0, source.byteLength, offset) !== source.byteLength) throw new Error('SQLite short write'); }
          catch (error) { account(path, Number(volume.fstatSync(fd).size)); throw error; }
        },
        truncate(size) { writable(); account(path, size); try { volume.ftruncateSync(fd, size); } catch (error) { account(path, Number(volume.fstatSync(fd).size)); throw error; } },
        size: () => Number(volume.fstatSync(fd).size),
        sync: () => {}, // Volatile memory only; this asserts no disk durability.
        lock(level) {
          const current = holders.get(identity)!;
          if (level <= current) return true;
          const others = [...holders].filter(([owner]) => owner !== identity).map(([, held]) => held);
          if (level === 1 && others.some(held => held >= 3)) return false;
          if (level >= 2 && others.some(held => held >= 2)) return false;
          if (level === 4 && others.some(held => held >= 1)) {
            holders.set(identity, 3); // Retain PENDING to prevent reader starvation.
            return false;
          }
          holders.set(identity, level); return true;
        },
        unlock: level => { holders.set(identity, level); },
        reserved: () => [...holders.values()].some(level => level >= 2),
        close() {
          if (closed) return;
          closed = true; holders.delete(identity);
          if (!holders.size) locks.delete(path);
          volume.closeSync(fd);
        }
      };
    },
    exists(path) { admit(path); return volume.existsSync(path); },
    delete(path) { admit(path); if (volume.existsSync(path)) volume.unlinkSync(path); retained -= sizes.get(path) ?? 0; sizes.delete(path); }
  };
}
