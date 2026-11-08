import type { FileStat } from '@poe-code/safe-fs/core';
import { FsError } from '@poe-code/safe-fs/contracts/errors';

/** Admit one live legacy stat observation. Numeric metadata cannot gain exact
 * bigint precision through coercion, and backend identity never crosses the wire. */
export function admitCanonicalMetadata(input: FileStat, syscall: 'stat' | 'lstat'): FileStat {
 // FileStat is a structural contract, not an enumerable-property record.
 // Capture its public fields once, including prototype accessors, without
 // observing private identity tokens or unrelated backend extension payloads.
 const { type, size, mode, atimeMs, mtimeMs, ctimeMs } = input;
 const observed: FileStat = { type, size, mode, atimeMs, mtimeMs, ctimeMs };
 for (const key of ['uid', 'gid', 'allocatedBytes', 'preferredIoBlockSize', 'revision', 'nlink', 'birthtimeMs'] as const) {
  const value = input[key];
  if (value !== undefined) Object.assign(observed, { [key]: value });
 }
 if (!['file', 'directory', 'symlink', 'character'].includes(observed.type)
  || !Number.isSafeInteger(observed.size) || observed.size < 0
  || observed.mode === undefined) throw new FsError('EIO', { syscall });
 for (const key of ['mode', 'uid', 'gid', 'allocatedBytes', 'preferredIoBlockSize', 'revision', 'nlink'] as const) {
  const value = observed[key];
  const limit = key === 'mode' ? 65535 : key === 'uid' || key === 'gid' ? 4294967295 : Number.MAX_SAFE_INTEGER;
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > limit)) throw new FsError('EIO', { syscall });
 }
 for (const key of ['atimeMs', 'mtimeMs', 'ctimeMs', 'birthtimeMs'] as const) {
  const value = observed[key];
  if ((key !== 'birthtimeMs' || value !== undefined)
   && (typeof value !== 'number' || !Number.isFinite(value))) throw new FsError('EIO', { syscall });
 }
 return observed;
}
