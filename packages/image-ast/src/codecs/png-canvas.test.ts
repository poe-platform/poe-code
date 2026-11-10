import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodePngImage, encodePngImage } from "./png.js";
import { encodePngFromStorage } from "./png-storage.js";

for (const stored of [false, true]) {
  it.each([
    { width: 1, height: 1, x: 0, y: 0 },
    { width: 2, height: 1, x: 0, y: 0 },
    { width: 1, height: 2, x: 0, y: 0 },
    { width: 1, height: 1, x: -1, y: 0 },
    { width: 1, height: 1, x: 0, y: 1 }
  ])(`preserves only nondefault PNG canvases, stored=${stored}: %j`, async virtualCanvas => {
    const image: RgbaImage = { width: 1, height: 1, data: Uint8Array.of(12, 34, 56, 78), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, virtualCanvas };
    const chunks: Uint8Array[] = [];
    if (stored) {
      const storage = { allocate: vi.fn(), read: vi.fn(async () => image.data), write: vi.fn() };
      for await (const chunk of encodePngFromStorage({ ...image, position: 0 }, storage, new AbortController().signal)) chunks.push(chunk);
    } else chunks.push(encodePngImage(image));
    const output = Buffer.concat(chunks);
    const decoded = decodePngImage(output);
    expect(decoded.data).toEqual(image.data);
    expect([decoded.width, decoded.height]).toEqual([1, 1]);
    const expected = virtualCanvas.width === 1 && virtualCanvas.height === 1 && virtualCanvas.x === 0 && virtualCanvas.y === 0 ? undefined : virtualCanvas;
    expect(decoded.virtualCanvas).toEqual(expected);
    const types: string[] = [];
    for (let offset = 8; offset + 12 <= output.length; offset += output.readUInt32BE(offset) + 12) {
      types.push(output.toString("ascii", offset + 4, offset + 8));
    }
    expect(types.filter(type => type === "caNv")).toHaveLength(expected ? 1 : 0);
  });
}
