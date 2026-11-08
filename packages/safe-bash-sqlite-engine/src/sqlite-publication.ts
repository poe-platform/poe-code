import { FsError, type ByteSource, type FileReadHandle, type FileStaging, type FileStat, type FileSystem } from 'safe-bash-contracts';
import { yieldTurn } from 'safe-bash-contracts/yield';
import { verifySqliteSnapshot } from './sqlite-snapshot.js';
import { sqliteSourceChunks } from './sqlite-stream.js';

/** Apply fixed-size replacements to a retained snapshot and conditionally publish
 * the resulting stream. The transaction owns the input handle and field sources. */
export async function publishSqliteSnapshot(options: {
  fs: FileSystem;
  snapshot: FileReadHandle;
  path: string;
  parent: FileStat;
  expected: FileStat | null;
  signal: AbortSignal;
  /** Caller-owned empty retained staging and the canonical sidecar versions
   * acquired with the database snapshot. Cleanup remains the caller's duty. */
  sourceSet?: {
    staging: FileStaging;
    wal: FileStat | null;
    journal: FileStat | null;
    shm: FileStat | null;
  };
  patches: readonly { offset: number; length: number; bytes: ByteSource }[];
}): Promise<FileStat> {
  const { fs, snapshot, path, signal } = options;
  const parent = { ...options.parent };
  const expected = options.expected === null ? null : { ...options.expected };
  const sourceSet = options.sourceSet;
  const staging = sourceSet?.staging;
  const companions = sourceSet === undefined ? undefined : (['wal', 'journal', 'shm'] as const).map(suffix => ({
    path: `${path}-${suffix}`, expected: sourceSet[suffix] === null ? null : { ...sourceSet[suffix] }, remove: true,
  }));
  signal.throwIfAborted();
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: expected === null }) ?? fs.capabilities;
  if (sourceSet !== undefined
    ? !fs.publishStagedFileSet || capabilities.retainedStagingWrite !== true || !staging?.writer
    : capabilities.atomicFilePublication !== true || !fs.publishFileConditional) {
    throw new FsError('ENOTSUP', { path, message: 'SQLite snapshots require atomic conditional publication' });
  }
  const original = await snapshot.stat({ signal });
  verifySqliteSnapshot(original, original);
  if (!Number.isSafeInteger(original.size) || original.size < 0) throw new RangeError('Invalid SQLite snapshot size');
  // Copy metadata so callers cannot change offsets while sources are consumed.
  const patches = options.patches.map(patch => ({ ...patch })).sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const patch of patches) {
    if (!Number.isSafeInteger(patch.offset) || !Number.isSafeInteger(patch.length) || patch.offset < end ||
        patch.length < 0 || patch.offset > original.size || patch.length > original.size - patch.offset) {
      throw new RangeError('Invalid or overlapping SQLite snapshot patch');
    }
    end = patch.offset + patch.length;
  }
  const check = async (): Promise<void> => {
    signal.throwIfAborted();
    verifySqliteSnapshot(await snapshot.stat({ signal }), original);
  };
  async function* copy(start: number, stop: number): ByteSource {
    while (start < stop) {
      await yieldTurn(signal);
      await check();
      const requested = Math.min(16384, stop - start);
      const bytes = await snapshot.read(start, requested, { signal });
      if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > requested) {
        throw new FsError('EIO', { message: 'Invalid SQLite snapshot read' });
      }
      const owned = bytes.slice();
      await check();
      yield owned;
      start += owned.length;
    }
  }
  async function* bytes(): ByteSource {
    let position = 0;
    for (const patch of patches) {
      yield* copy(position, patch.offset);
      let received = 0;
      for await (const chunk of sqliteSourceChunks(patch.bytes, signal)) {
        await check();
        if (!(chunk instanceof Uint8Array)) throw new TypeError('SQLite patch source must yield bytes');
        if (chunk.length > patch.length - received) throw new RangeError('SQLite patch length exceeded');
        for (let offset = 0; offset < chunk.length; offset += 16384) {
          await yieldTurn(signal);
          await check();
          yield chunk.slice(offset, offset + 16384);
        }
        received += chunk.length;
      }
      if (received !== patch.length) throw new RangeError('SQLite patch length mismatch');
      position = patch.offset + patch.length;
    }
    yield* copy(position, original.size);
    await check();
  }
  if (staging && companions) {
    if (staging.file.stat.size !== 0 || staging.file.stat.type !== 'file') {
      throw new FsError('EINVAL', { path: staging.file.path, message: 'SQLite publication requires empty regular-file staging' });
    }
    for await (const chunk of bytes()) await staging.writer!.write(chunk, { signal });
    const stat = await staging.writer!.finish({ signal });
    if (stat.type !== 'file' || stat.size !== original.size) {
      throw new FsError('EIO', { path: staging.file.path, message: 'SQLite staged snapshot size mismatch' });
    }
    await check();
    return fs.publishStagedFileSet!({ ...staging, file: { ...staging.file, stat } }, path, {
      parent, destination: expected, companions, signal,
    });
  }
  return fs.publishFileConditional!(path, bytes(), { parent, expected, signal, mode: 0o600, maxBytes: original.size });
}
