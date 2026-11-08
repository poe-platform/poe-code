import { shellValueByteLength } from "safe-bash-contracts/value";

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

export function latin1Bytes(text: string): Uint8Array {

  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index) & 255;
  return bytes;
}

export function latin1Text(bytes: Uint8Array): string {

  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export function isByteEncoding(value: string): boolean {
  return ["utf8", "utf-8", "latin1", "binary", "ascii", "utf16le", "utf-16le", "ucs2", "ucs-2", "hex", "base64", "base64url"].includes(value.toLowerCase());
}

export function encodeBytes(value: string | ArrayLike<number> | ArrayBufferLike, encodingOrOffset?: string | number, length?: number): Uint8Array {
  if (typeof value !== "string") {
    if (value instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
      return new Uint8Array(value, typeof encodingOrOffset === "number" ? encodingOrOffset : 0, length);
    }
    return Uint8Array.from(value as ArrayLike<number>);
  }
  const encoding = typeof encodingOrOffset === "string" ? encodingOrOffset.toLowerCase() : "utf8";
  if (encoding === "latin1" || encoding === "binary" || encoding === "ascii") return latin1Bytes(value);
  if (["utf16le", "utf-16le", "ucs2", "ucs-2"].includes(encoding)) {
    const bytes = new Uint8Array(value.length * 2);
    for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); bytes[i * 2] = code & 255; bytes[i * 2 + 1] = code >>> 8; }
    return bytes;
  }
  if (encoding === "hex") {
    const digits = "0123456789abcdef";
    const bytes: number[] = [];
    for (let i = 0; i + 1 < value.length; i += 2) {
      const high = digits.indexOf(String.fromCharCode(value.charCodeAt(i) & 255).toLowerCase()), low = digits.indexOf(String.fromCharCode(value.charCodeAt(i + 1) & 255).toLowerCase());
      if (high < 0 || low < 0) break;
      bytes.push(high * 16 + low);
    }
    return Uint8Array.from(bytes);
  }
  if (encoding === "base64" || encoding === "base64url") {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes: number[] = [];
    let accumulator = 0, bits = 0;
    for (let i = 0; i < value.length; i++) {
      const character = String.fromCharCode(value.charCodeAt(i) & 255);
      if (character === "=") break;
      const digit = alphabet.indexOf(character === "-" ? "+" : character === "_" ? "/" : character);
      if (digit < 0) continue;
      accumulator = (accumulator << 6) | digit; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((accumulator >>> bits) & 255); }
    }
    return Uint8Array.from(bytes);
  }
  if (encoding !== "utf8" && encoding !== "utf-8") throw new TypeError(`Unknown byte encoding: ${encoding}`);
  return encoder.encode(value);
}

export function decodeBytes(bytes: Uint8Array, encoding = "utf8", start = 0, end = bytes.length): string {
  bytes = bytes.subarray(Math.max(0, start), Math.max(0, end));
  encoding = encoding.toLowerCase();
  if (encoding === "latin1" || encoding === "binary") return latin1Text(bytes);
  if (encoding === "ascii") { let result = ""; for (const byte of bytes) result += String.fromCharCode(byte & 127); return result; }
  if (encoding === "hex") return bytesToHex(bytes);
  if (["utf16le", "utf-16le", "ucs2", "ucs-2"].includes(encoding)) {
    let result = ""; for (let i = 0; i + 1 < bytes.length; i += 2) result += String.fromCharCode(bytes[i]! | bytes[i + 1]! << 8); return result;
  }
  if (encoding === "base64" || encoding === "base64url") {
    const alphabet = encoding === "base64" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let result = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const value = bytes[i]! << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
      result += alphabet[(value >>> 18) & 63]! + alphabet[(value >>> 12) & 63]!;
      if (i + 1 < bytes.length) result += alphabet[(value >>> 6) & 63]; else if (encoding === "base64") result += "=";
      if (i + 2 < bytes.length) result += alphabet[value & 63]; else if (encoding === "base64") result += "=";
    }
    return result;
  }
  if (encoding !== "utf8" && encoding !== "utf-8") throw new TypeError(`Unknown byte encoding: ${encoding}`);
  return decoder.decode(bytes);
}

export function byteLength(value: string | ArrayBufferLike | ArrayBufferView, encoding = "utf8"): number {
  if (typeof value !== "string") return value.byteLength;
  encoding = encoding.toLowerCase();
  if (["latin1", "binary", "ascii"].includes(encoding)) return value.length;
  if (["utf16le", "utf-16le", "ucs2", "ucs-2"].includes(encoding)) return value.length * 2;
  if (encoding === "hex") return value.length >>> 1;
  if (encoding === "base64" || encoding === "base64url") {
    let length = value.length; if (value[length - 1] === "=") length--; if (value[length - 1] === "=") length--; return Math.floor(length * 3 / 4);
  }
  return shellValueByteLength(value);
}

export function concatBytes(chunks: readonly Uint8Array[], length = chunks.reduce((size, chunk) => size + chunk.length, 0)): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { const count = Math.min(chunk.length, length - offset); if (count <= 0) continue; result.set(chunk.subarray(0, count), offset); offset += count; }
  return result;
}

export function compareByteArrays(left: Uint8Array, right: Uint8Array): number {
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
}

export function indexOfBytes(bytes: Uint8Array, needle: Uint8Array | number, start = 0): number {
  if (typeof needle === "number") return bytes.indexOf(needle, start);
  for (let i = Math.max(0, start); i <= bytes.length - needle.length; i++) { let matched = true; for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) { matched = false; break; } if (matched) return i; }
  return -1;
}

export function writeEncodedBytes(bytes: Uint8Array, text: string, offset = 0, lengthOrEncoding: number | string = bytes.length - offset, encoding = "utf8"): number {
  const length = typeof lengthOrEncoding === "number" ? lengthOrEncoding : bytes.length - offset;
  if (typeof lengthOrEncoding === "string") encoding = lengthOrEncoding;
  encoding = encoding.toLowerCase();
  const target = bytes.subarray(offset, offset + length);
  if (encoding === "utf8" || encoding === "utf-8") return encoder.encodeInto(text, target).written;
  const source = encodeBytes(text, encoding), count = Math.min(target.length, source.length);
  target.set(source.subarray(0, count)); return count;
}
