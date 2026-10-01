import { readSqliteVarint } from './sqlite-varint.js';
import { FsError, type ByteSource, type FileReadHandle } from 'safe-bash-contracts';
import { verifySqliteSnapshot } from './sqlite-snapshot.js';
import { yieldTurn } from 'safe-bash-contracts/yield';

function corrupt(): never { throw new FsError('EIO', { message: 'Invalid SQLite table record or page chain' }); }
function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) return corrupt();
  return bytes[offset]! * 256 + bytes[offset + 1]!;
}
function u32(bytes: Uint8Array, offset: number): number {
  return u16(bytes, offset) * 65536 + u16(bytes, offset + 2);
}


export interface SqliteRecordSource {
  readonly size: number;
  /** Retained snapshot range; omitted bounds read the complete record. */
  bytes(offset?: number, length?: number): ByteSource;
}

/** Read a table-btree row from a retained, closed/checkpointed SQLite snapshot.
 * The caller owns the handle; no ambient filesystem, full-file read or page cache.
 * Returned streams remain tied to the original snapshot revision and signal. */
export async function findSqliteRecord(file: FileReadHandle, rootPage: number, rowid: bigint, signal: AbortSignal): Promise<SqliteRecordSource | undefined> {
  signal.throwIfAborted();
  if (rowid < -(1n << 63n) || rowid >= 1n << 63n) throw new RangeError('SQLite rowid out of range');
  const expected = await file.stat({ signal });
  verifySqliteSnapshot(expected, expected);
  if (!Number.isSafeInteger(expected.size) || expected.size < 100) return corrupt();
  const check = async (): Promise<void> => { signal.throwIfAborted(); verifySqliteSnapshot(await file.stat({ signal }), expected); };
  const read = async (position: number, count: number): Promise<Uint8Array> => {
    await check();
    if (!Number.isSafeInteger(position) || position < 0 || count < 0 || count > 65536 || position + count > expected.size) return corrupt();
    const bytes = new Uint8Array(count);
    for (let offset = 0; offset < count;) {
      const part = await file.read(position + offset, count - offset, { signal });
      if (!(part instanceof Uint8Array) || !part.length || part.length > count - offset) return corrupt();
      bytes.set(part, offset); offset += part.length;
    }
    await check();
    return bytes;
  };
  const header = await read(0, 100);
  const magic = 'SQLite format 3\0';
  if ([...magic].some((character, index) => header[index] !== character.charCodeAt(0))) return corrupt();
  const encodedSize = u16(header, 16), pageSize = encodedSize === 1 ? 65536 : encodedSize;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 || expected.size % pageSize) return corrupt();
  const usable = pageSize - header[20]!;
  if (usable < 480) return corrupt();
  const pages = expected.size / pageSize;
  const page = async (number: number, length = pageSize): Promise<Uint8Array> => {
    if (!Number.isSafeInteger(number) || number < 1 || number > pages) return corrupt();
    await yieldTurn(signal);
    return (await read((number - 1) * pageSize, length)).subarray(0, usable);
  };
  let number = rootPage;
  for (let depth = 0; depth < pages; depth++) {
    const data = await page(number), start = number === 1 ? 100 : 0;
    const kind = data[start];
    if (kind !== 5 && kind !== 13) return corrupt();
    const count = u16(data, start + 3), pointers = start + (kind === 5 ? 12 : 8);
    if (pointers + count * 2 > usable) return corrupt();
    let child = kind === 5 ? u32(data, start + 8) : 0;
    for (let i = 0; i < count; i++) {
      const cell = u16(data, pointers + i * 2);
      if (cell < pointers + count * 2 || cell >= usable) return corrupt();
      if (kind === 5) {
        const key = BigInt.asIntN(64, readSqliteVarint(data, cell + 4).value);
        if (rowid <= key) { child = u32(data, cell); break; }
      } else {
        const payload = readSqliteVarint(data, cell), key = readSqliteVarint(data, payload.end);
        if (BigInt.asIntN(64, key.value) !== rowid) continue;
        const size = Number(payload.value);
        if (!Number.isSafeInteger(size)) return corrupt();
        const max = usable - 35, min = Math.floor((usable - 12) * 32 / 255) - 23;
        let local = size <= max ? size : min + (size - min) % (usable - 4);
        if (local > max) local = min;
        if (key.end + local + (local < size ? 4 : 0) > usable) return corrupt();
        const first = data.slice(key.end, key.end + local);
        const overflow = local < size ? u32(data, key.end + local) : 0;
        return { size, async *bytes(offset = 0, length = size - offset) {
          if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
              offset > size || length > size - offset) throw new RangeError('Invalid SQLite record range');
          await check();
          const stop = offset + length;
          async function* emit(content: Uint8Array, position: number): ByteSource {
            const start = Math.max(0, offset - position), end = Math.min(content.length, stop - position);
            for (let index = start; index < end; index += 16384) {
              await check(); yield content.slice(index, Math.min(end, index + 16384));
            }
          }
          yield* emit(first, 0);
          let position = local, next = overflow, traversed = 0;
          while (length && position < stop) {
            if (++traversed > pages) return corrupt();
            const available = Math.min(size - position, usable - 4);
            const skipped = position + available <= offset;
            const content = await page(next, skipped ? 4 : pageSize);
            next = u32(content, 0);
            if (!skipped) yield* emit(content.subarray(4, 4 + available), position);
            position += available;
          }
          if (stop === size && length && next !== 0) return corrupt();
          await check();
        } };
      }
    }
    if (kind === 13) return undefined;
    number = child;
  }
  return corrupt();
}
