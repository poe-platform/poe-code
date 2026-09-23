export interface FoldUnit { cp: number; length: number; valid: boolean }
export function decodeFoldUnit(bytes: ArrayLike<number>, offset: number, available: number, eof: boolean): FoldUnit | undefined {
  const first = bytes[offset]!;
  if (first < 128) return { cp: first, length: 1, valid: true };
  const length = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1;
  const invalid = { cp: first, length: 1, valid: false };
  if (length === 1) return invalid;
  for (let i = 1; i < Math.min(length, available); i++) {
    const b = bytes[offset + i]!;
    if (b < 128 || b > 191 || (i === 1 && ((first === 0xe0 && b < 0xa0) || (first === 0xed && b > 0x9f) || (first === 0xf0 && b < 0x90) || (first === 0xf4 && b > 0x8f)))) return invalid;
  }
  if (available < length) return eof ? invalid : undefined;
  let cp = first & (length === 2 ? 31 : length === 3 ? 15 : 7);
  for (let i = 1; i < length; i++) cp = cp * 64 + (bytes[offset + i]! & 63);
  return { cp, length, valid: true };
}
