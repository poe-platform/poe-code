import { Reader } from "./binary.js";
import { synchsafe } from "./id3.js";

/** Physical size of a leading ID3v2 tag, including an optional v2.4 footer. */
export function id3HeaderSize(bytes: Uint8Array): number {
  if (bytes[0] !== 73 || bytes[1] !== 68 || bytes[2] !== 51) return 0;
  const reader = new Reader(bytes), version = reader.u8(3), flags = reader.u8(5);
  if (![2, 3, 4].includes(version)) throw new Error("Unsupported ID3 version");
  return 10 + synchsafe(reader, 6) + (version === 4 && flags & 16 ? 10 : 0);
}
