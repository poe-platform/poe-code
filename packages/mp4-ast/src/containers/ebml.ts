export function readVint(
  bytes: Uint8Array,
  offset: number,
  stripMarker: boolean
): { value: number; length: number; unknownSize: boolean } | null {
  if (offset >= bytes.byteLength) return null;
  const first = bytes[offset]!;
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>>= 1;
  }
  if (length > 8 || offset + length > bytes.byteLength) return null;
  let value = stripMarker ? first & (mask - 1) : first;
  let unknownSize = stripMarker && value === mask - 1;
  for (let i = 1; i < length; i++) {
    unknownSize = unknownSize && bytes[offset + i] === 0xff;
    value = value * 256 + bytes[offset + i]!;
  }
  return { value, length, unknownSize };
}

export function writeVintSize(size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid EBML size");
  let length = 1;
  while (size >= 2 ** (7 * length) - 1 && length < 8) length++;
  const bytes = new Uint8Array(length);
  let remaining = size;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] = bytes[0]! | (1 << (8 - length));
  return bytes;
}
