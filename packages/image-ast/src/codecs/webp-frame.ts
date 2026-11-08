import type { MetadataRead } from "./exif-metadata.js";

/** Locate an ANMF's nested image chunks without retaining its compressed bytes. */
export function* webpFrameSteps(size: number, page: number): Generator<MetadataRead, {
  position: number; length: number; header: Uint8Array;
  width: number; height: number; x: number; y: number; disposal: number;
}, Uint8Array> {
  if (!Number.isInteger(page) || page < 0) throw new RangeError("WebP frame is out of range");
  let index = 0;
  for (let position = 12; position + 8 <= size;) {
    const chunk = yield { position, length: 8 };
    const length = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true);
    if (position + 8 + length > size) throw new Error("Truncated WebP chunk");
    if (String.fromCharCode(...chunk.subarray(0, 4)) === "ANMF" && index++ === page) {
      if (length < 24) throw new Error("Invalid WebP frame");
      const frame = yield { position: position + 8, length: 16 };
      const uint24 = (at: number) => frame[at]! + frame[at + 1]! * 256 + frame[at + 2]! * 65536;
      const header = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
      new DataView(header.buffer).setUint32(4, length - 12, true);
      return { position: position + 24, length: length - 16, header,
        x: uint24(0) * 2, y: uint24(3) * 2, width: uint24(6) + 1, height: uint24(9) + 1,
        disposal: (frame[15]! & 1) ? 2 : 1 };
    }
    position += 8 + length + (length & 1);
  }
  throw new RangeError("WebP frame is out of range");
}
