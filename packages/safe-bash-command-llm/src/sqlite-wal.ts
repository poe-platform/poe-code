import { FsError, type FileReadHandle, type FileStat } from 'safe-bash-contracts';
import type { FileDescriptor } from '@poe-code/safe-fs/contracts';
import { yieldTurn } from 'safe-bash-contracts/yield';
import { verifySqliteSnapshot } from './sqlite-snapshot.js';
import { readSqliteFile, writeSqliteFile } from './sqlite-file-io.js';

const u32 = (bytes: Uint8Array, offset: number): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);

/** Overlay committed WAL pages on a retained database using caller-owned scratch.
 * The caller must acquire a consistent source set and keep it retained. This
 * function detects later changes; it does not acquire database locks or publish.
 * All three handles remain caller-owned, including after an error. Scratch must
 * be a distinct empty file, exclusively owned until the returned handle closes. */
export async function createSqliteWalSnapshot(database: FileReadHandle, wal: FileReadHandle, index: FileDescriptor, options: { signal: AbortSignal; maxIndexBytes: number }): Promise<FileReadHandle> {
  const { signal, maxIndexBytes } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxIndexBytes) || maxIndexBytes < 0) throw new RangeError('Invalid SQLite WAL index budget');
  const dbStat = await database.stat({ signal }), walStat = await wal.stat({ signal }), scratchStat = await index.stat({ signal });
  for (const stat of [dbStat, walStat, scratchStat]) {
    verifySqliteSnapshot(stat, stat);
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new FsError('EIO', { message: 'Invalid SQLite file size' });
  }
  const sameFile = (a: FileStat, b: FileStat): boolean => a.identityScope === b.identityScope &&
    (a.opaqueIdentity !== undefined ? a.opaqueIdentity === b.opaqueIdentity : a.dev === b.dev && a.ino === b.ino);
  if (scratchStat.size !== 0 || sameFile(scratchStat, dbStat) || sameFile(scratchStat, walStat)) {
    throw new FsError('EINVAL', { message: 'SQLite WAL index requires a distinct empty scratch file' });
  }
  let indexStat: FileStat | undefined = undefined;
  let closed = false;
  const check = async (operationSignal = signal): Promise<void> => {
    if (closed) throw new FsError('EBADF', { message: 'SQLite WAL snapshot is closed' });
    signal.throwIfAborted(); operationSignal.throwIfAborted();
    verifySqliteSnapshot(await database.stat({ signal: operationSignal }), dbStat);
    verifySqliteSnapshot(await wal.stat({ signal: operationSignal }), walStat);
    if (indexStat) verifySqliteSnapshot(await index.stat({ signal: operationSignal }), indexStat);
    signal.throwIfAborted(); operationSignal.throwIfAborted();
  };
  const read = async (file: FileReadHandle, position: number, length: number, operationSignal = signal): Promise<Uint8Array> => {
    await check(operationSignal);
    const bytes = new Uint8Array(length);
    for (let done = 0; done < length;) {
      await yieldTurn(operationSignal);
      const part = await file.read(position + done, length - done, { signal: operationSignal });
      if (!(part instanceof Uint8Array) || !part.length || part.length > length - done) throw new FsError('EIO', { message: 'Truncated SQLite WAL snapshot' });
      bytes.set(part, done); done += part.length;
    }
    await check(operationSignal);
    return bytes;
  };
  if (dbStat.size < 100) throw new FsError('EIO', { message: 'Invalid SQLite database header' });
  const dbHeader = await read(database, 0, 100);
  const magic = 'SQLite format 3\0';
  const encodedSize = dbHeader[16]! * 256 + dbHeader[17]!, pageSize = encodedSize === 1 ? 65536 : encodedSize;
  if ([...magic].some((c, i) => dbHeader[i] !== c.charCodeAt(0)) || pageSize < 512 || pageSize > 65536 ||
      (pageSize & (pageSize - 1)) !== 0 || dbStat.size % pageSize) throw new FsError('EIO', { message: 'Invalid SQLite database header' });
  const header = walStat.size >= 32 ? await read(wal, 0, 32) : new Uint8Array(32);
  const walMagic = u32(header, 0), little = walMagic === 0x377f0682;
  const checksum = (bytes: Uint8Array, previous: readonly number[]): [number, number] => {
    let a = previous[0]!, b = previous[1]!;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < bytes.length; offset += 8) {
      a = (a + view.getUint32(offset, little) + b) >>> 0;
      b = (b + view.getUint32(offset + 4, little) + a) >>> 0;
    }
    return [a, b];
  };
  let sum = checksum(header.subarray(0, 24), [0, 0]);
  const validHeader = (walMagic === 0x377f0682 || walMagic === 0x377f0683) &&
    u32(header, 8) === pageSize && sum[0] === u32(header, 24) && sum[1] === u32(header, 28);
  if (validHeader && u32(header, 4) !== 3007000) throw new FsError('EIO', { message: 'Unsupported SQLite WAL format version' });
  let commitFrame = 0, committedPages = dbStat.size / pageSize;
  const frameBytes = 24 + pageSize;
  if (validHeader) {
    for (let offset = 32, number = 1; offset + frameBytes <= walStat.size; offset += frameBytes, number++) {
      const frame = await read(wal, offset, 24);
      if (!u32(frame, 0) || u32(frame, 8) !== u32(header, 16) || u32(frame, 12) !== u32(header, 20)) break;
      const next = checksum(await read(wal, offset + 24, pageSize), checksum(frame.subarray(0, 8), sum));
      if (next[0] !== u32(frame, 16) || next[1] !== u32(frame, 20)) break;
      sum = next;
      if (u32(frame, 4)) { commitFrame = number; committedPages = u32(frame, 4); }
    }
  }
  const indexBytes = commitFrame ? (committedPages + 1) * 8 : 0;
  if (indexBytes > maxIndexBytes) throw new FsError('EFBIG', { message: 'SQLite WAL page index exceeds scratch budget' });
  await check();
  verifySqliteSnapshot(await index.stat({ signal }), scratchStat);
  await index.truncate(indexBytes, { signal });
  for (let number = 1; number <= commitFrame; number++) {
    const offset = 32 + (number - 1) * frameBytes, page = u32(await read(wal, offset, 8), 0);
    if (page > committedPages) continue;
    const slot = new Uint8Array(8);
    new DataView(slot.buffer).setBigUint64(0, BigInt(offset + 25));
    await writeSqliteFile(index, slot, page * 8, signal);
  }
  indexStat = await index.stat({ signal });
  await check();
  const identityScope = Symbol('SQLite WAL snapshot');
  return {
    async stat(operation) {
      const operationSignal = operation?.signal ? AbortSignal.any([signal, operation.signal]) : signal;
      await check(operationSignal);
      return { ...dbStat, size: committedPages * pageSize, identityScope, opaqueIdentity: 'wal-snapshot' };
    },
    async read(position, length, operation) {
      if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0 || length > 65536 || !Number.isSafeInteger(position + length)) throw new RangeError('Invalid SQLite snapshot range');
      const operationSignal = operation?.signal ? AbortSignal.any([signal, operation.signal]) : signal;
      await check(operationSignal);
      const result = new Uint8Array(Math.max(0, Math.min(length, committedPages * pageSize - position)));
      for (let done = 0; done < result.length;) {
        const page = Math.floor((position + done) / pageSize) + 1, within = (position + done) % pageSize;
        let source = database, offset = (page - 1) * pageSize;
        if (commitFrame) {
          const slot = new Uint8Array(8);
          if (!await readSqliteFile(index, slot, page * 8, operationSignal)) throw new FsError('EIO', { message: 'Truncated SQLite WAL index' });
          const stored = new DataView(slot.buffer).getBigUint64(0);
          if (stored) { source = wal; offset = Number(stored - 1n); }
        }
        const count = Math.min(pageSize - within, result.length - done);
        result.set(await read(source, offset + within, count, operationSignal), done); done += count;
      }
      await check(operationSignal);
      return result;
    },
    async close() { closed = true; }
  };
}
