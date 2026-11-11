import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeMiffFromStorage, encodeMiffImage } from "./miff.js";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const depth of [8, 16] as const) for (const hasAlpha of [false, true]) {
    it.each(["none", "rle", "zip", "bzip"] as const)(`keeps indexed pixels across storage chunks (${depth} bits, alpha=${hasAlpha}, %s)`, async compression => {
        const width = 1031, palette = Uint8Array.of(255, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255);
        const indices = Uint8Array.from({ length: width }, (_, i) => i < 1025 ? 2 : 1);
        const data = Uint8Array.from({ length: width * 4 }, (_, i) => i % 4 === 3 ? 128 : palette[indices[Math.floor(i / 4)]! * 3 + i % 4]!);
        const data16 = Uint16Array.from(data, (value, i) => i % 4 === 3 ? 0x8001 : value * 257);
        const image: RgbaImage = { width, height: 1, data, data16, pngPalette: { bytes: palette, depth: 2 }, pngIndices: indices,
            format: "png", space: "srgb", hasAlpha, channels: hasAlpha ? 4 : 3, depth: "ushort", density: 72 };
        const backing = Buffer.concat([data, new Uint8Array(data16.buffer), indices]), borrowed = new Uint8Array(8192);
        const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (position: number, length: number) => {
            expect(length).toBeLessThanOrEqual(borrowed.length);
            borrowed.fill(0); borrowed.set(backing.subarray(position, position + length));
            return borrowed.subarray(0, length);
        }) };
        const stored = { ...image, position: 0, storedData16: { position: data.length, length: data.length }, storedPngIndices: { position: data.length * 3, width, height: 1 } };
        const chunks: Uint8Array[] = [];
        for await (const chunk of encodeMiffFromStorage({ ...stored, storedMiffPages: { length: 2, async at() { return stored; } } }, storage, new AbortController().signal, depth, compression)) chunks.push(chunk);
        for (const bytes of [encodeMiffImage({ ...image, miffPages: [image, image] }, depth, compression), Buffer.concat(chunks)]) {
            const output = Buffer.from(bytes), offset = output.indexOf(Buffer.from([58, 26])) + 2;
            expect(output.subarray(0, offset).toString()).toContain("class=PseudoClass colors=4");
            expect(output.subarray(offset, offset + palette.length * depth / 8)).toEqual(Buffer.from(depth === 8 ? palette : [...palette].flatMap(value => [value, value])));
            expect(readMiffHeader(bytes).metadata.pages).toBe(2);
            const decoded = decodeMiffImage(bytes, { page: 1 });
            expect(decoded.data.filter((_, i) => i % 4 !== 3)).toEqual(data.filter((_, i) => i % 4 !== 3));
            expect([...decoded.data].filter((_, i) => i % 4 === 3).every(value => value === (hasAlpha ? 128 : 255))).toBe(true);
            const retained = new Uint8Array(width * 12);
            let end = 0;
            const reread = await decodeMiffToStorage({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }, {
                allocate(length) { const offset = end; end += length; return offset; },
                async read(offset, length) { return retained.subarray(offset, offset + length); },
                async write(offset, data) { retained.set(data, offset); }
            }, new AbortController().signal, { page: 1 });
            expect(retained.subarray(reread.position, reread.position + data.length)).toEqual(decoded.data);
            if (depth === 16) expect(new Uint16Array(retained.buffer, reread.storedData16!.position, data.length)).toEqual(decoded.data16);
            if (nativeMagick) {
                const rendered = spawnSync("magick", ["miff:-", "-depth", String(depth), "-endian", "MSB", "rgba:-"], { input: bytes });
                expect(rendered.status, rendered.stderr.toString()).toBe(0);
                // Native 7.1.2 also leaves RGB unset when reading PseudoClass RLE; cycling resolves the colormap.
                const red = compression === "rle" ? 0 : 255;
                expect([...rendered.stdout.subarray(0, depth / 2)]).toEqual(depth === 8 ? [red, 0, 0, hasAlpha ? 128 : 255] : [red, red, 0, 0, 0, 0, hasAlpha ? 128 : 255, hasAlpha ? 1 : 255]);
                const result = spawnSync("magick", ["miff:-", "-cycle", "1", "-depth", "8", "rgba:-"], { input: bytes });
                expect(result.status, result.stderr.toString()).toBe(0);
                // Duplicate red index 2 cycles to unused blue index 3, not green index 1.
                expect([...result.stdout.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
                expect([...result.stdout.subarray(-4)]).toEqual([255, 0, 0, 255]);
            }
        }
    });
}

for (const depth of [8, 16] as const) {
    it.each([false, true])(`keeps direct output for changed pixels or an explicit direct class (${depth} bits, direct=%s)`, async direct => {
        const data = Uint8Array.of(255, 0, 0, 255), data16 = Uint16Array.of(65534, 0, 0, 65535);
        if (direct) data16[0] = 65535;
        else if (depth === 8) data[0] = 254;
        const image: RgbaImage = { width: 1, height: 1, data, data16, ...(direct ? { isPalette: false } : {}), pngPalette: { bytes: Uint8Array.of(255, 0, 0), depth: 1 }, pngIndices: Uint8Array.of(0),
            format: "png", space: "srgb", hasAlpha: false, channels: 3, depth: "ushort", density: 72 };
        const backing = Buffer.concat([data, new Uint8Array(data16.buffer), image.pngIndices!]);
        const storage = { allocate: vi.fn(), write: vi.fn(), async read(offset: number, length: number) { return backing.subarray(offset, offset + length); } };
        const chunks: Uint8Array[] = [];
        for await (const chunk of encodeMiffFromStorage({ ...image, position: 0, storedData16: { position: 4, length: 4 }, storedPngIndices: { position: 12, width: 1, height: 1 } }, storage, new AbortController().signal, depth)) chunks.push(chunk);
        for (const bytes of [encodeMiffImage(image, depth), Buffer.concat(chunks)]) {
            expect(Buffer.from(bytes).toString()).toContain("class=DirectClass colors=0");
            const decoded = decodeMiffImage(bytes);
            expect(depth === 8 ? decoded.data : decoded.data16).toEqual(depth === 8 ? data : data16);
        }
    });
}
