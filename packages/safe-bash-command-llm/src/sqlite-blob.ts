import { FsError, type ByteSource } from 'safe-bash-contracts';
import { yieldTurn } from 'safe-bash-contracts/yield';
import { sqliteSourceChunks } from './sqlite-stream.js';

export interface SqliteBlobModule {
  readonly HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  cwrap(name: string, result: string, arguments_: string[], options?: { async: boolean }): unknown;
}

/** Fill an already-sized value in a private native SQLite transaction. The
 * caller serializes native calls and discards/rolls back the transaction on any
 * failure. No full-value allocation or SQL string interpolation is required.
 * check ferries the original VFS error across native result codes. */
export async function writeSqliteBlob(module: SqliteBlobModule, options: {
  database: number; table: string; column: string; rowid: bigint;
  source: ByteSource; size: number; signal: AbortSignal; check: () => void;
}): Promise<void> {
  const { database, table, column, rowid, source, size, signal, check } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(size) || size < 0 || size > 0x7fffffff) throw new RangeError('Invalid native SQLite blob length');
  if (rowid < -(1n << 63n) || rowid >= 1n << 63n) throw new RangeError('SQLite rowid out of range');
  if (!table || !column || table.includes('\0') || column.includes('\0')) throw new TypeError('Invalid SQLite blob column');
  const open = module.cwrap('sqlite3_blob_open', 'number', ['number', 'string', 'string', 'string', 'number', 'number', 'number', 'number'], { async: true }) as
    (database: number, name: string, table: string, column: string, low: number, high: number, writable: number, out: number) => Promise<number>;
  const length = module.cwrap('sqlite3_blob_bytes', 'number', ['number']) as (blob: number) => number;
  const write = module.cwrap('sqlite3_blob_write', 'number', ['number', 'number', 'number', 'number'], { async: true }) as (blob: number, buffer: number, size: number, offset: number) => Promise<number>;
  const close = module.cwrap('sqlite3_blob_close', 'number', ['number'], { async: true }) as (blob: number) => Promise<number>;
  const result = (code: number): void => { check(); if (code !== 0) throw new FsError('EIO', { message: `Native SQLite blob operation failed (${code})` }); };
  let out = 0, buffer = 0, blob = 0;
  const errors: unknown[] = [];
  try {
    check();
    out = module._malloc(4);
    if (!out) throw new RangeError('SQLite memory allocation failed');
    new DataView(module.HEAPU8.buffer).setInt32(out, 0, true);
    const code = await open(database, 'main', table, column, Number(BigInt.asIntN(32, rowid)), Number(BigInt.asIntN(32, rowid >> 32n)), 1, out);
    blob = new DataView(module.HEAPU8.buffer).getInt32(out, true);
    result(code); signal.throwIfAborted();
    if (!blob || length(blob) !== size) throw new RangeError('SQLite blob length mismatch');
    if (size) {
      buffer = module._malloc(Math.min(16384, size));
      if (!buffer) throw new RangeError('SQLite memory allocation failed');
    }
    let position = 0;
    for await (const chunk of sqliteSourceChunks(source, signal)) {
      await yieldTurn(signal);
      if (!(chunk instanceof Uint8Array)) throw new TypeError('SQLite blob source must yield bytes');
      if (chunk.length > size - position) throw new RangeError('SQLite blob source length exceeded');
      for (let offset = 0; offset < chunk.length;) {
        await yieldTurn(signal);
        const count = Math.min(16384, chunk.length - offset);
        module.HEAPU8.set(chunk.subarray(offset, offset + count), buffer);
        result(await write(blob, buffer, count, position));
        signal.throwIfAborted(); position += count; offset += count;
      }
    }
    if (position !== size) throw new RangeError('SQLite blob source length mismatch');
    signal.throwIfAborted();
  } catch (error) { errors.push(error); }
  if (!blob && out) try { blob = new DataView(module.HEAPU8.buffer).getInt32(out, true); } catch (error) { errors.push(error); }
  if (blob) try {
    const code = await close(blob);
    if (!errors.length) check();
    if (code !== 0) errors.push(new FsError('EIO', { message: `Native SQLite blob close failed (${code})` }));
  } catch (error) { errors.push(error); }
  for (const pointer of [buffer, out]) if (pointer) try { module._free(pointer); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'SQLite blob write and cleanup failed');
}
