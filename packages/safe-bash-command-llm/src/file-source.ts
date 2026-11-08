import { FsError, type FileSystem, type FileStat } from 'safe-bash-contracts';
import type { LlmInputSource } from './types.js';

function sameFile(actual: FileStat, expected: FileStat): void {
  const identified = expected.opaqueIdentity !== undefined
    ? expected.opaqueIdentity === actual.opaqueIdentity
    : expected.dev !== undefined && expected.ino !== undefined && expected.dev === actual.dev && expected.ino === actual.ino;
  if (!identified || expected.identityScope === undefined || expected.identityScope !== actual.identityScope || actual.type !== 'file'
    || actual.size !== expected.size || actual.revision !== expected.revision || actual.opaqueVersion !== expected.opaqueVersion
    || actual.mtimeMs !== expected.mtimeMs || actual.ctimeMs !== expected.ctimeMs) throw new FsError('EBUSY', {message: 'LLM attachment changed'});
}

export async function fileSource({fs, path, signal, maxBytes = Infinity, expectedStat}: {fs: FileSystem; path: string; signal: AbortSignal; maxBytes?: number; expectedStat?: FileStat}): Promise<LlmInputSource> {
  signal.throwIfAborted();
  const capabilities = await fs.capabilitiesFor?.(path, {signal}) ?? fs.capabilities;
  if (!capabilities.retainedRead || !fs.openReadFile) throw new FsError('ENOTSUP', {message: 'LLM attachment sources require retained reads'});
  const expected = await fs.stat(path, {signal});
  if (expectedStat) sameFile(expected, expectedStat);
  if (expected.type !== 'file') throw new FsError('EINVAL', {path});
  if (expected.size > maxBytes) throw new FsError('EFBIG', {message: 'LLM attachment input byte limit exceeded'});
  const reader = await fs.openReadFile(path, {signal});
  let closing: Promise<void> | undefined;
  const dispose = (): Promise<void> => closing ??= reader.close();
  try { sameFile(await reader.stat({signal}), expected); }
  catch (error) { await dispose(); throw error; }
  let consumed = false;
  return {
    dispose,
    bytes: {async *[Symbol.asyncIterator]() {
      if (consumed || closing) throw new FsError('EBADF', {message: 'LLM attachment source is closed'});
      consumed = true;
      let position = 0;
      while (position < expected.size) {
        signal.throwIfAborted();
        if (closing) throw new FsError('EBADF', {message: 'LLM attachment source is closed'});
        sameFile(await reader.stat({signal}), expected);
        const length = Math.min(16384, expected.size - position);
        const bytes = await reader.read(position, length, {signal});
        if (closing) throw new FsError('EBADF', {message: 'LLM attachment source is closed'});
        signal.throwIfAborted();
        if (!bytes.byteLength || bytes.byteLength > length) throw new FsError('EIO', {message: 'Invalid LLM attachment read'});
        sameFile(await reader.stat({signal}), expected);
        position += bytes.byteLength;
        yield bytes;
      }
      sameFile(await reader.stat({signal}), expected);
    }}
  };
}
