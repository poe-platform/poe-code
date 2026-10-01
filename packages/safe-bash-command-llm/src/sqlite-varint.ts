import { FsError } from 'safe-bash-contracts';

export function readSqliteVarint(bytes: Uint8Array, start: number): { value: bigint; end: number } {
  let value = 0n;
  for (let i = 0; i < 9; i++) {
    const byte = bytes[start + i];
    if (byte === undefined) throw new FsError('EIO', { message: 'Invalid SQLite varint' });
    value = (value << BigInt(i === 8 ? 8 : 7)) | BigInt(i === 8 ? byte : byte & 127);
    if (i === 8 || byte < 128) return { value, end: start + i + 1 };
  }
  throw new FsError('EIO', { message: 'Invalid SQLite varint' });
}
