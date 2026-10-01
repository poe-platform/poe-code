import { FsError } from 'safe-bash-contracts';
import type { SqliteRecordSource } from './sqlite-pages.js';
import type { SqliteRecordValue } from './sqlite-record.js';
import { readSqliteVarint } from './sqlite-varint.js';
import { sqliteSourceChunks } from './sqlite-stream.js';

function corrupt(): never { throw new FsError('EIO', { message: 'Invalid SQLite record fields' }); }

/** Decode a known schema's record without materializing TEXT or BLOB values.
 * Field sources borrow the original retained snapshot and its lifetime. Memory
 * for metadata is bounded by the caller's schema column count, not field sizes. */
export async function readSqliteValues(record: SqliteRecordSource, columns: number, signal: AbortSignal): Promise<SqliteRecordValue[]> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(columns) || columns < 0 || !Number.isSafeInteger(columns * 9 + 9)) {
    throw new RangeError('Invalid SQLite column count');
  }
  if (!Number.isSafeInteger(record.size) || record.size < 1) return corrupt();
  async function read(offset: number, length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    let received = 0;
    for await (const chunk of sqliteSourceChunks(record.bytes(offset, length), signal)) {
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array) || chunk.length > length - received) return corrupt();
      result.set(chunk, received); received += chunk.length;
    }
    if (received !== length) return corrupt();
    return result;
  }
  const prefix = readSqliteVarint(await read(0, Math.min(9, record.size)), 0);
  const headerSize = Number(prefix.value);
  if (!Number.isSafeInteger(headerSize) || headerSize < prefix.end || headerSize > record.size || headerSize > columns * 9 + 9) return corrupt();
  const header = await read(prefix.end, headerSize - prefix.end);
  const fields: { serial: number; offset: number; size: number }[] = [];
  let cursor = 0, position = headerSize;
  while (cursor < header.length) {
    if (fields.length >= columns) return corrupt();
    const next = readSqliteVarint(header, cursor);
    cursor = next.end;
    const serial = Number(next.value);
    if (!Number.isSafeInteger(serial) || serial === 10 || serial === 11) return corrupt();
    const size = serial >= 12 ? Math.floor((serial - 12) / 2) : [0, 1, 2, 3, 4, 6, 8, 8, 0, 0][serial]!;
    if (size > record.size - position) return corrupt();
    fields.push({ serial, offset: position, size });
    position += size;
  }
  if (fields.length !== columns || position !== record.size) return corrupt();
  const values: SqliteRecordValue[] = [];
  for (const field of fields) {
    signal.throwIfAborted();
    if (field.serial === 0) values.push(null);
    else if (field.serial === 8 || field.serial === 9) values.push(BigInt(field.serial - 8));
    else if (field.serial >= 12) {
      values.push({ type: field.serial % 2 ? 'text' : 'blob', size: field.size, bytes: {
        async *[Symbol.asyncIterator]() {
          let received = 0;
          for await (const chunk of sqliteSourceChunks(record.bytes(field.offset, field.size), signal)) {
            signal.throwIfAborted();
            if (!(chunk instanceof Uint8Array) || chunk.length > field.size - received) return corrupt();
            for (let offset = 0; offset < chunk.length; offset += 16384) {
              signal.throwIfAborted(); yield chunk.slice(offset, offset + 16384);
            }
            received += chunk.length;
          }
          if (received !== field.size) return corrupt();
        },
      } });
    } else {
      const bytes = await read(field.offset, field.size);
      if (field.serial === 7) values.push(new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0));
      else {
        let value = 0n;
        for (const byte of bytes) value = value * 256n + BigInt(byte);
        values.push(BigInt.asIntN(field.size * 8, value));
      }
    }
  }
  return values;
}
