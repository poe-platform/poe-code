import { FsError, type FileStat } from 'safe-bash-contracts';

export function verifySqliteSnapshot(actual: FileStat, expected: FileStat): void {
  const identity = expected.opaqueIdentity !== undefined ? actual.opaqueIdentity === expected.opaqueIdentity
    : expected.dev !== undefined && expected.ino !== undefined && actual.dev === expected.dev && actual.ino === expected.ino;
  if (!identity || expected.identityScope === undefined || expected.identityScope !== actual.identityScope ||
      actual.type !== 'file' || actual.size !== expected.size || actual.revision !== expected.revision ||
      actual.opaqueVersion !== expected.opaqueVersion || actual.mtimeMs !== expected.mtimeMs || actual.ctimeMs !== expected.ctimeMs) {
    throw new FsError('EBUSY', { message: 'SQLite retained snapshot changed' });
  }
}

