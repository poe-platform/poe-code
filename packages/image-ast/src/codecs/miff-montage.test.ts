import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodeMiffImage } from "./miff-input.js";
import { encodeMiffFromStorage, encodeMiffImage } from "./miff.js";

it("round trips montage directories before the palette and raster in both encoders", async () => {
    const frame: RgbaImage = { width: 1, height: 1, format: "miff", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
        data: Uint8Array.of(18, 52, 86, 255), pngPalette: { bytes: Uint8Array.of(18, 52, 86), depth: 8 }, pngIndices: Uint8Array.of(0),
        montage: { geometry: "1x1+0+0", directory: ["snow 雪.ppm", "space name.ppm"] } };
    const bytes = encodeMiffImage(frame);
    expect(decodeMiffImage(bytes)).toMatchObject({ montage: frame.montage, data: frame.data });
    const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (offset: number) => offset === 4 ? Uint8Array.of(0) : frame.data) };
    const chunks: Uint8Array[] = [];
    for await (const chunk of encodeMiffFromStorage({ ...frame, position: 0, storedPngIndices: { position: 4, width: 1, height: 1 } }, storage, new AbortController().signal)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    const end = Buffer.from(bytes).indexOf(Buffer.from(":\x1a")) + 2;
    expect(() => decodeMiffImage(bytes.slice(0, end + 3))).toThrow("Truncated MIFF montage directory");
});
