import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { encodeImage } from "./index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";

for (const depth of [8, 16] as const) {
    it.each([1, 2, 3, 4] as const)(`encodes bounded RLE runs with %i channels at ${depth} bits`, async channels => {
        const width = 1027;
        const data = Uint8Array.from({ length: width * 4 }, (_, index) => [18, 52, 86, 128][index % 4]!);
        const data16 = Uint16Array.from(data, value => value * 257 + 1);
        const frame: RgbaImage = { width, height: 1, format: "png", depth: depth === 16 ? "ushort" : "uchar", density: 72,
            space: channels <= 2 ? "b-w" : "srgb", channels, hasAlpha: channels === 2 || channels === 4, data, data16 };
        const encoded = encodeImage(frame, { format: "miff", miffDepth: depth, miffCompression: "rle" }).data;
        const source = depth === 16 ? new Uint8Array(data16.buffer) : data;
        const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (position: number, length: number) => source.subarray(position, position + length)) };
        const chunks: Uint8Array[] = [];
        for await (const chunk of encodeStoredImage({ ...frame, position: 0, storedData16: { position: 0, length: data16.length } }, storage, new AbortController().signal, { format: "miff", miffDepth: depth, miffCompression: "rle" })) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(encoded));
        const payload = encoded.subarray(encoded.indexOf(26) + 1);
        const stride = channels * depth / 8 + 1;
        expect(payload.length).toBe(5 * stride);
        expect([0, 1, 2, 3, 4].map(index => payload[(index + 1) * stride - 1])).toEqual([255, 255, 255, 255, 2]);
        const selected = channels <= 2 ? frame.hasAlpha ? [0, 3] : [0] : frame.hasAlpha ? [0, 1, 2, 3] : [0, 1, 2];
        expect([...payload.subarray(0, stride - 1)]).toEqual(selected.flatMap(index => depth === 8 ? [data[index]!] : [data16[index]! >> 8, data16[index]! & 255]));
        expect(storage.read.mock.calls.every(([, length]) => length <= 8192)).toBe(true);
        if (spawnSync("magick", ["-version"]).status === 0) {
            const decoded = spawnSync("magick", ["miff:-", "-depth", String(depth), "-endian", "MSB", "rgba:-"], { input: encoded });
            expect(decoded.status).toBe(0);
            const expected = Uint8Array.from({ length: width * 4 * depth / 8 }, (_, index) => {
                const sample = Math.floor(index / (depth / 8)) % 4;
                const value = sample === 3 && !frame.hasAlpha ? 65535 : data16[channels <= 2 && sample < 3 ? 0 : sample]!;
                return depth === 8 ? value >> 8 : index % 2 === 0 ? value >> 8 : value & 255;
            });
            expect(new Uint8Array(decoded.stdout)).toEqual(expected);
        }
    });
}
