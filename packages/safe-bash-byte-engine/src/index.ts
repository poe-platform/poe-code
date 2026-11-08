const encoder = new TextEncoder();
export function utf8ByteLength(value: string): number {
 let size = 0;
 for (let i = 0; i < value.length; i++) {
  const code = value.charCodeAt(i);
  if (code < 128) size++;
  else if (code < 2048) size += 2;
  else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
  else size += 3;
 }
 return size;
}
export function bytesFrom(value: string | Uint8Array | readonly number[] | ArrayBufferLike, offset?: number | "utf8" | "latin1" | "utf16le", length?: number): Uint8Array {
 if (typeof value === "string") {
  if (offset === "latin1") { const bytes = new Uint8Array(value.length); for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 255; return bytes; }
  if (offset === "utf16le") { const bytes = new Uint8Array(value.length * 2); for (let i = 0; i < value.length; i++) { const unit = value.charCodeAt(i); bytes[i * 2] = unit & 255; bytes[i * 2 + 1] = unit >>> 8; } return bytes; }
  return encoder.encode(value);
 }
 if (Array.isArray(value)) return Uint8Array.from(value);
 if (value instanceof Uint8Array) return new Uint8Array(value);
 return new Uint8Array(value as ArrayBufferLike, typeof offset === "number" ? offset : undefined, length);
}
export function concatBytes(parts: readonly Uint8Array[], size = parts.reduce((sum, part) => sum + part.length, 0)): Uint8Array {
 const out = new Uint8Array(size); let offset = 0;
 for (const part of parts) { const length = Math.min(part.length, size - offset); out.set(part.subarray(0, length), offset); offset += length; if (offset === size) break; }
 return out;
}
export function compareBytes(left: Uint8Array, right: Uint8Array): number {
 for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1;
 return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}
export function filledBytes(size: number, value = 0): Uint8Array { return new Uint8Array(size).fill(value); }
export function latin1Text(bytes: Uint8Array): string { let result = ""; for (const byte of bytes) result += String.fromCharCode(byte); return result; }
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
 if (left.length !== right.length) return false;
 for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
 return true;
}

export function base64Text(bytes: Uint8Array): string {
 const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let out = "";
 for (let i = 0; i < bytes.length; i += 3) {
  const a = bytes[i]!, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
  out += alphabet[a >>> 2]! + alphabet[((a & 3) << 4) | (b >>> 4)]! + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >>> 6)]! : "=") + (i + 2 < bytes.length ? alphabet[c & 63]! : "=");
 } return out;
}
