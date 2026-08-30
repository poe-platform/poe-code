import type { Session } from "./io.js";

export async function crc32(session: Session, bytes: Uint8Array): Promise<number> {
  let value = 0xffffffff;
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    const end = Math.min(bytes.length, offset + 4096);
    await session.step(end - offset);
    for (let cursor = offset; cursor < end; cursor++) {
      value ^= bytes[cursor]!;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
