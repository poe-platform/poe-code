import { FsError, type ByteSource } from 'safe-bash-contracts';
import { yieldTurn } from 'safe-bash-contracts/yield';
import type { SqliteBlobModule } from './sqlite-blob.js';

/** Incrementally read a native TEXT or BLOB field. Consume inside the owning
 * session callback, serializing native calls; no handle may escape its lifetime. */
export async function* readSqliteBlob(module: SqliteBlobModule, options: {
  database: number; table: string; column: string; rowid: bigint;
  signal: AbortSignal; check(): void; maxBytes?: number;
}): ByteSource {
  const { database, table, column, rowid, signal, check } = options;
  signal.throwIfAborted();
  const maxBytes = options.maxBytes ?? Infinity;
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new RangeError('Invalid SQLite read limit');
  if (rowid < -(1n << 63n) || rowid >= 1n << 63n) throw new RangeError('SQLite rowid out of range');
  if (!table || !column || table.includes('\0') || column.includes('\0')) throw new TypeError('Invalid SQLite blob column');
  const open = module.cwrap('sqlite3_blob_open', 'number', ['number','string','string','string','number','number','number','number'], { async: true }) as
    (database: number, name: string, table: string, column: string, low: number, high: number, writable: number, out: number) => Promise<number>;
  const length = module.cwrap('sqlite3_blob_bytes', 'number', ['number']) as (blob: number) => number;
  const read = module.cwrap('sqlite3_blob_read', 'number', ['number','number','number','number'], { async: true }) as (blob: number, pointer: number, count: number, offset: number) => Promise<number>;
  const close = module.cwrap('sqlite3_blob_close', 'number', ['number'], { async: true }) as (blob: number) => Promise<number>;
  const result = (code: number): void => { check(); if (code !== 0) throw new FsError('EIO', { message: `Native SQLite blob read failed (${code})` }); };
  let out = 0, blob = 0, buffer = 0;
  let failed = false, failure: unknown;
  const finish = async (): Promise<void> => {
    const errors: unknown[] = failed ? [failure] : [];
    if (!blob && out) try { blob = new DataView(module.HEAPU8.buffer).getInt32(out,true); } catch (error) { errors.push(error); }
    if (blob) try {
      const code = await close(blob);
      if (!failed) check();
      if (code !== 0) errors.push(new FsError('EIO', { message: `Native SQLite blob close failed (${code})` }));
    } catch (error) { errors.push(error); }
    for (const pointer of [buffer,out]) if (pointer) try { module._free(pointer); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors,'SQLite blob read and cleanup failed');
  };
  try {
    check(); out = module._malloc(4);
    if (!out) throw new RangeError('SQLite memory allocation failed');
    new DataView(module.HEAPU8.buffer).setInt32(out, 0, true);
    const code = await open(database, 'main', table, column, Number(BigInt.asIntN(32,rowid)), Number(BigInt.asIntN(32,rowid >> 32n)), 0, out);
    blob = new DataView(module.HEAPU8.buffer).getInt32(out, true);
    result(code); signal.throwIfAborted();
    const size = length(blob);
    if (!blob || !Number.isSafeInteger(size) || size < 0) throw new FsError('EIO', { message: 'Invalid SQLite blob size' });
    if (size > maxBytes) throw new FsError('EFBIG', { message: 'LLM schema input byte limit exceeded' });
    if (size) {
      buffer = module._malloc(Math.min(16384,size));
      if (!buffer) throw new RangeError('SQLite memory allocation failed');
    }
    for (let offset = 0; offset < size; offset += 16384) {
      await yieldTurn(signal); signal.throwIfAborted(); check();
      const count = Math.min(16384,size-offset);
      result(await read(blob,buffer,count,offset)); signal.throwIfAborted();
      yield module.HEAPU8.slice(buffer,buffer+count);
    }
  } catch (error) { failed = true; failure = error; }
  finally { await finish(); }
}
