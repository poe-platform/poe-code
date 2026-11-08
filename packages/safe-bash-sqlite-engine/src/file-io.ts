import { FsError } from 'safe-bash-contracts';
import type { FileDescriptor } from '@poe-code/safe-fs/contracts';
import { yieldTurn } from 'safe-bash-contracts/yield';

/** Read into a native SQLite view without lending WASM memory to the filesystem.
 * False means EOF: SQLite requires the unread suffix to be zero-filled. The
 * transaction owns the descriptor and must discard its snapshot on failure. */
export async function readSqliteFile(file: FileDescriptor, target: Uint8Array, position: number, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + target.length)) {
    throw new RangeError('Invalid SQLite file range');
  }
  const buffer = new Uint8Array(Math.min(16384, target.length));
  let done = 0;
  while (done < target.length) {
    await yieldTurn(signal);
    const requested = Math.min(buffer.length, target.length - done);
    const count = await file.read(buffer.subarray(0, requested), position + done, { signal });
    signal.throwIfAborted();
    if (!Number.isSafeInteger(count) || count < 0 || count > requested) {
      throw new FsError('EIO', { message: 'Invalid SQLite file read result' });
    }
    if (count === 0) { target.fill(0, done); return false; }
    target.set(buffer.subarray(0, count), done);
    done += count;
  }
  return true;
}

/** Complete a native SQLite write with bounded owned chunks and short-write
 * retries. A zero-progress or invalid backend result is an I/O failure. */
export async function writeSqliteFile(file: FileDescriptor, source: Uint8Array, position: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + source.length)) {
    throw new RangeError('Invalid SQLite file range');
  }
  let done = 0;
  while (done < source.length) {
    await yieldTurn(signal);
    const bytes = source.slice(done, Math.min(source.length, done + 16384));
    const count = await file.write(bytes, position + done, { signal });
    signal.throwIfAborted();
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length) {
      throw new FsError('EIO', { message: 'Invalid SQLite file write result' });
    }
    done += count;
  }
}
