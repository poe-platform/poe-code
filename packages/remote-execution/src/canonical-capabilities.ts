import type { FileSystemCapabilities } from '@poe-code/safe-fs/core';
import { FsError } from '@poe-code/safe-fs/contracts/errors';

/** Structural contract fields may be non-enumerable prototype accessors. Capture
 * each guarantee once at access time, preserving absent versus explicit false.
 * Own enumerable extensions retain the existing boolean capability profile. */
export function admitCanonicalCapabilities(input: unknown, syscall: 'capabilities' | 'rmdir', path: string, maxBytes?: number): FileSystemCapabilities {
 if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new TypeError('Invalid capability metadata bound');
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FsError('EIO', { syscall, path });
 const fields = new Set([
  'readOnly', 'read', 'stat', 'readdir', 'realpath', 'access', 'write', 'append',
  'exclusiveCreate', 'explicitDirectories', 'implicitDirectories', 'mkdir',
  'recursiveMkdir', 'remove', 'removeDirectory', 'recursiveRemove', 'rename',
  'copy', 'exclusiveCopy', 'readlink', 'truncate', 'streamingAppend',
  'randomAccessWrite', 'symlinks', 'hardlinks', 'permissions', 'timestamps',
  'atomicRename', 'atomicFileStaging', 'atomicFileMutation',
  'atomicDirectoryMetadata', 'atomicRenameNoReplace', 'snapshotRmdir',
  'streamingRead', 'retainedRead', 'retainedResize', 'atomicResize',
  'streamingWrite', 'descriptorWriteStream', ...Object.keys(input),
 ]);
 const observed: Record<string, boolean | undefined> = {};
 let remaining = maxBytes === undefined ? Infinity : maxBytes - 2;
 let members = 0;
 if (remaining < 0) throw new FsError('EFBIG', { syscall, path });
 for (const field of fields) {
  if (!(field in input)) continue;
  const value = Reflect.get(input, field);
  if (value !== undefined && typeof value !== 'boolean') throw new FsError('EIO', { syscall, path });
  if (value !== undefined) {
   // Admit the UTF-16 lower bound before encoding potentially large extension
   // names. Count JSON escaping, UTF-8 octets, punctuation and boolean values;
   // undefined guarantees have no member in the wire observation.
   if (field.length > remaining) throw new FsError('EFBIG', { syscall, path });
   remaining -= new TextEncoder().encode(JSON.stringify(field)).length + 1 + (value ? 4 : 5) + (members++ ? 1 : 0);
   if (remaining < 0) throw new FsError('EFBIG', { syscall, path });
  }
  Object.defineProperty(observed, field, { value, enumerable: true, writable: true, configurable: true });
 }
 return observed;
}
