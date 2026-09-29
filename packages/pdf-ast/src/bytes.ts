// Adapted from Mozilla PDF.js src/shared/util.js (Apache-2.0).
// See THIRD_PARTY_NOTICES.md. These strings represent bytes, not Unicode text.
export function bytesToString(bytes: Uint8Array): string {
  if (typeof bytes !== "object" || bytes?.length === undefined) {
    throw new Error("Invalid argument for bytesToString");
  }
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return chunks.join("");
}

export function stringToBytes(str: string): Uint8Array {
  if (typeof str !== "string") {
    throw new Error("Invalid argument for stringToBytes");
  }
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}
