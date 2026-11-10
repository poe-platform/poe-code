import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeMiffImage } from "./miff.js";
import { decodeMiffImage } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

for (const depth of [8, 16] as const) for (const channels of [1, 2, 3, 4] as const) {
    it(`decodes BZip across packets and borrowed reads: ${channels} channels, ${depth} bits`, async () => {
        const count = 2051, data16 = Uint16Array.from({ length: count * 4 }, (_, i) => (i * 7919) % 65536);
        const data = Uint8Array.from(data16, value => Math.round(value / 257));
        const image: RgbaImage = { width: count, height: 1, channels, depth: depth === 16 ? "ushort" : "uchar", hasAlpha: channels === 2 || channels === 4, space: channels <= 2 ? "b-w" : "srgb", format: "miff", density: 72, data, ...(depth === 16 ? { data16 } : {}) };
        const bytes = encodeMiffImage(image, depth, "bzip");
        const expected = decodeMiffImage(encodeMiffImage(image, depth));
        const decoded = decodeMiffImage(bytes);
        expect(decoded.data).toEqual(expected.data);
        expect(decoded.data16).toEqual(expected.data16);
        const backing = new Uint8Array(count * 12), borrowed = new Uint8Array(8192);
        let end = 0;
        const source = { size: bytes.length, async read(offset: number, length: number) {
            expect(length).toBeLessThanOrEqual(8192);
            borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length));
            return borrowed.subarray(0, length);
        } };
        const storage = {
            allocate(length: number) { const start = end; end += length; return start; },
            async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
            async write(offset: number, bytes: Uint8Array) { backing.set(bytes, offset); }
        };
        const stored = await decodeMiffToStorage(source, storage, new AbortController().signal);
        expect(backing.subarray(stored.position, stored.position + count * 4)).toEqual(expected.data);
        if (depth === 16) expect(new Uint16Array(backing.buffer, stored.storedData16!.position, count * 4)).toEqual(expected.data16);
        const limited = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
        await expect(decodeMiffToStorage(source, limited, new AbortController().signal, { limitInputPixels: 1 })).rejects.toThrow();
        expect(limited.allocate).not.toHaveBeenCalled();
    });
}
