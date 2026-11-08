import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";
import { encodeMiffImage, encodeMiffFromStorage } from "./miff.js";
import type { RgbaImage } from "../ast.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const depth of [8, 16] as const) for (const width of [1, 2051]) {
    it.each([1, 2, 3, 4] as const)(`BZip compresses multiple frames with %i channels at ${depth} bits, width=${width}`, async channels => {
        const data = new Uint8Array(randomBytes(4 * 2051));
        const data16 = Uint16Array.from({ length: data.length }, (_, index) => (index * 1237) & 65535);
        const image: RgbaImage = { width, height: 2051 / width, data, ...(depth === 16 ? { data16 } : {}), format: "miff", space: channels <= 2 ? "b-w" : "srgb", channels, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: channels === 2 || channels === 4 };
        const source = depth === 16 ? new Uint8Array(data16.buffer) : data;
        const stored = { ...image, position: 0, ...(depth === 16 ? { storedData16: { position: 0, length: data.length } } : {}) };
        const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (position: number, size: number) => source.subarray(position, position + size)) };
        const chunks: Uint8Array[] = [];
        for await (const chunk of encodeMiffFromStorage({ ...stored, storedMiffPages: { length: 2, async at() { return stored; } } }, storage, new AbortController().signal, depth, "bzip")) chunks.push(chunk);
        expect(storage.read.mock.calls.every(([, size]) => size <= 8192)).toBe(true);
        const buffered = encodeMiffImage({ ...image, miffPages: [image, image] }, depth, "bzip");
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(buffered));
        const uncompressed = encodeMiffImage({ ...image, miffPages: [image, image] }, depth);
        if (nativeMagick) {
            const expected = spawnSync("magick", ["miff:-", "-depth", String(depth), "rgba:-"], { input: uncompressed });
            expect(expected.status).toBe(0);
            for (const bytes of [buffered, Buffer.concat(chunks)]) {
                const identified = spawnSync("magick", ["identify", "-format", "%C;", "miff:-"], { input: bytes });
                expect(identified.status, identified.stderr.toString()).toBe(0);
                expect(identified.stdout.toString()).toBe("BZip;BZip;");
                const decoded = spawnSync("magick", ["miff:-", "-depth", String(depth), "rgba:-"], { input: bytes });
                expect(decoded.status, decoded.stderr.toString()).toBe(0);
                expect(decoded.stdout).toEqual(expected.stdout);
            }
        }
    });
}
