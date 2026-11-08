import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { makeChunk } from "./codecs/png-chunks.js";
import { encodePngImage } from "./codecs/png.js";
import { readMngLayoutFromSource } from "./codecs/mng-input-storage.js";
import sharp from "./index.js";

function mng(...controls: Uint8Array[]) {
  const header = new Uint8Array(28), view = new DataView(header.buffer);
  view.setUint32(0, 1); view.setUint32(4, 1); view.setUint32(8, 100);
  const png = encodePngImage({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "png", channels: 4, space: "srgb", depth: "uchar", density: 72, hasAlpha: false });
  return Uint8Array.from([...[138, 77, 78, 71, 13, 10, 26, 10], ...makeChunk("MHDR", header), ...controls.flatMap(bytes => [...bytes]), ...png.subarray(8), ...makeChunk("MEND", new Uint8Array())]);
}

it("reads single-frame metadata and honors pixel limits and page selection", () => {
  const bytes = mng();
  expect(readImageMetadata(bytes)).toMatchObject({ format: "mng", width: 1, height: 1, pages: 1, delay: [10], loop: 1 });
  expect([...decodeImage(bytes).data]).toEqual([255, 0, 0, 255]);
  expect(() => decodeImage(bytes, { limitInputPixels: 0.5 })).toThrow("pixel limit");
  expect(() => decodeImage(bytes, { page: 1 })).toThrow("page out of range");
});

it("rejects truncated controls, missing ends and unsupported MNG object operations", () => {
  expect(() => decodeImage(mng(makeChunk("FRAM", Uint8Array.of(1, 0, 2))))).toThrow("Invalid MNG FRAM");
  expect(() => decodeImage(mng().subarray(0, -12))).toThrow("missing MEND");
  expect(() => decodeImage(mng(makeChunk("DEFI", new Uint8Array(12))))).toThrow("Unsupported MNG chunk: DEFI");
  expect(() => decodeImage(mng(makeChunk("FRAM", Uint8Array.of(2))))).toThrow("Unsupported MNG framing mode");
});

it("inspects retained metadata with small ranges, validates reads and honors cancellation", async () => {
  const bytes = mng(), controller = new AbortController();
  const source = { size: bytes.length, async read(position: number, length: number) {
    expect(length).toBeLessThanOrEqual(28);
    return bytes.subarray(position, position + length);
  } };
  expect((await readMngLayoutFromSource(source, controller.signal)).metadata.pages).toBe(1);
  await expect(readMngLayoutFromSource({ size: bytes.length, async read() { return new Uint8Array(); } }, controller.signal)).rejects.toThrow("Truncated MNG source");
  controller.abort(new Error("cancelled"));
  await expect(readMngLayoutFromSource(source, controller.signal)).rejects.toThrow("cancelled");
});

it("exposes MNG through the Sharp format registry", () => {
  expect(sharp.format.mng.input).toEqual({ file: true, buffer: true, stream: true });
});
