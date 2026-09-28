export const utf8Encoder = new TextEncoder();

export { shellValueByteLength as utf8ByteLength } from "safe-bash-contracts/value";

export function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index]! - right[index]!;
    if (difference) return difference;
  }
  return left.length - right.length;
}
