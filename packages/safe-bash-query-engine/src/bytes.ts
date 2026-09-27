import { byteString as decodeLatin1, latin1Bytes as encodeLatin1 } from "./encoding.js";
export { utf8ByteLength, encoder as utf8Encoder, decoder as utf8Decoder } from "./encoding.js";
export { decodeLatin1, encodeLatin1 };

export function encodeBase64(bytes: Uint8Array): string {
  return btoa(decodeLatin1(bytes));
}

export function decodeBase64(text: string): Uint8Array {
  return encodeLatin1(atob(text));
}

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}
