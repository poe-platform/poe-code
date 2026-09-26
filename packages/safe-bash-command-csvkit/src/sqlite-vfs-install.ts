import type init from '@sqlite.org/sqlite-wasm';
import type { SQLiteFileSystem, SQLiteFile } from './sqlite-vfs.js';

export function installSqliteVfs(sqlite: Awaited<ReturnType<typeof init>>, backend: SQLiteFileSystem | undefined, clock: { now(): number }, random: (bytes: Uint8Array) => void): { name: string; dispose(): void; takeFailure(): unknown } {
  const { capi: c, wasm } = sqlite;
  const io = new c.sqlite3_io_methods(), vfs = new c.sqlite3_vfs();
  // Struct fields use C's $ spelling at runtime (upstream types omit several).
  const ioFields = io as typeof io & { $iVersion: number };
  const vfsFields = vfs as typeof vfs & { $iVersion: number; $szOsFile: number; $mxPathname: number };
  ioFields.$iVersion = 1; vfsFields.$iVersion = 1;
  const fileType = new c.sqlite3_file();
  vfsFields.$szOsFile = fileType.structInfo.sizeof;
  fileType.dispose();
  vfsFields.$mxPathname = 4096;
  const files = new Map<number, { file: SQLiteFile; struct: InstanceType<typeof c.sqlite3_file>; path: string; flags: number }>();
  let failure: unknown;
  const guard = (action: () => void, code: number = c.SQLITE_IOERR): number => { try { action(); return c.SQLITE_OK; } catch (error) { failure = error; return code; } };
  const offset = (value: number | bigint): number => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('SQLite file offset'); return n; };
  const name = `csvkit-vfs-${vfs.pointer}`;
  try { sqlite.vfs.installVfs({
    io: { struct: io, methods: {
      xClose: pointer => guard(() => {
        const entry = files.get(pointer)!; files.delete(pointer);
        try { entry.file.close(); if (entry.flags & c.SQLITE_OPEN_DELETEONCLOSE) backend!.delete(entry.path, false); }
        finally { entry.struct.dispose(); }
      }),
      xRead: (pointer, target, length, position) => {
        try {
          const bytes = wasm.heap8u().subarray(target, target + length); bytes.fill(0);
          return files.get(pointer)!.file.read(bytes, offset(position)) === length ? c.SQLITE_OK : c.SQLITE_IOERR_SHORT_READ;
        } catch (error) { failure = error; return c.SQLITE_IOERR_READ; }
      },
      xWrite: (pointer, source, length, position) => guard(() => files.get(pointer)!.file.write(wasm.heap8u().subarray(source, source + length), offset(position)), c.SQLITE_IOERR_WRITE),
      xTruncate: (pointer, size) => guard(() => files.get(pointer)!.file.truncate(offset(size)), c.SQLITE_IOERR_TRUNCATE),
      xSync: pointer => guard(() => files.get(pointer)!.file.sync(), c.SQLITE_IOERR_FSYNC),
      xFileSize: (pointer, output) => guard(() => { wasm.poke64(output, files.get(pointer)!.file.size()); }),
      xLock: (pointer, level) => { try { return files.get(pointer)!.file.lock(level) ? c.SQLITE_OK : c.SQLITE_BUSY; } catch (error) { failure = error; return c.SQLITE_IOERR_LOCK; } },
      xUnlock: (pointer, level) => guard(() => files.get(pointer)!.file.unlock(level)),
      xCheckReservedLock: (pointer, output) => guard(() => { wasm.poke32(output, files.get(pointer)!.file.reserved() ? 1 : 0); }),
      xFileControl: () => c.SQLITE_NOTFOUND,
      xSectorSize: () => 4096,
      xDeviceCharacteristics: () => 0
    } },
    vfs: { struct: vfs, name, methods: {
      xOpen: (_vfs, path, pointer, flags, output) => guard(() => {
        if (!backend || !path) throw new Error('Unbound SQLite file');
        const filename = wasm.cstrToJs(path)!;
        const file = backend.open(filename, flags), struct = new c.sqlite3_file(pointer);
        struct.$pMethods = io.pointer;
        files.set(pointer, { file, struct, path: filename, flags });
        if (output) wasm.poke32(output, flags);
      }, c.SQLITE_CANTOPEN),
      xDelete: (_vfs, path, sync) => guard(() => backend!.delete(wasm.cstrToJs(path)!, !!sync), c.SQLITE_IOERR_DELETE),
      xAccess: (_vfs, path, _flags, output) => guard(() => { wasm.poke32(output, backend?.exists(wasm.cstrToJs(path)!) ? 1 : 0); }),
      xFullPathname: (_vfs, path, length, output) => wasm.cstrncpy(output, path, length) < length ? c.SQLITE_OK : c.SQLITE_CANTOPEN,
      xRandomness: (_vfs, length, output) => { try { random(wasm.heap8u().subarray(output, output + length)); return length; } catch { return 0; } },
      xSleep: () => 0,
      xCurrentTime: (_vfs, output) => guard(() => { wasm.poke64f(output, 2440587.5 + clock.now() / 86400000); }),
      xGetLastError: () => 0
    } }
  }); } catch (error) {
    c.sqlite3_vfs_unregister(vfs);
    vfs.dispose(); io.dispose();
    throw error;
  }
  let disposed = false;
  return { name, takeFailure() { const error = failure; failure = undefined; return error; }, dispose() {
    if (disposed) return;
    if (files.size) throw new Error('SQLite VFS still has open files');
    c.sqlite3_vfs_unregister(vfs);
    vfs.dispose(); io.dispose(); disposed = true;
  } };
}
