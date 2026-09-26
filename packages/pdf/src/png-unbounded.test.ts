import {expect, it, vi} from "vitest";
const reachedInflater = new Error("admitted scanline allocation");
vi.mock("pako", () => ({Inflate: class {constructor() {throw reachedInflater;}}}));
import {decodePng} from "./png.js";
function chunk(name: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(name), 4); bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
it("admits PNG scanlines beyond the old implicit twenty-million-byte ceiling", () => {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 20_000_000); view.setUint32(4, 1); header[8] = 8;
  const parts = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", new Uint8Array([0])), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {png.set(part, offset); offset += part.length;}
  const work = vi.fn();
  expect(() => decodePng(png, work)).toThrow(reachedInflater);
  expect(work).toHaveBeenCalledWith(20_000_001);
});
