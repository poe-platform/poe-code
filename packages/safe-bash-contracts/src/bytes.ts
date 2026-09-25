const encoder = new TextEncoder();

export function encodeUtf8(value: string): Uint8Array { return encoder.encode(value); }

/** Count UTF-8 bytes without allocating encoded storage before budget admission. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4; index++;
    } else bytes += 3;
  }
  return bytes;
}

export function concatBytes(parts: readonly Uint8Array[], size = parts.reduce((total, part) => total + part.length, 0)): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
