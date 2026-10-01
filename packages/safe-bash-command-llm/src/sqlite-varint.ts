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

export function writeSqliteVarint(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) throw new RangeError('SQLite varint out of range');
  const bytes: number[] = [];
  if (value > 0x00ffffffffffffffn) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  while (value > 127n) { bytes.unshift(Number(value & 127n) | (bytes.length ? 128 : 0)); value >>= 7n; }
  bytes.unshift(Number(value) | (bytes.length ? 128 : 0));
  return Uint8Array.from(bytes);
}
