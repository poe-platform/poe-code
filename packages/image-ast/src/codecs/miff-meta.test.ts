import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeMiffFromStorage, encodeMiffImage } from "./miff.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const depth of [8, 16] as const) for (const channels of [1, 2, 3, 4] as const) {
    for (const compression of ["none", "rle", "zip", "bzip"] as const) {
        it.skipIf(compression !== "none" && !nativeMagick)(`preserves meta planes with ${channels} color/alpha channels, ${depth} bits, ${compression}`, async () => {
            const width = 1031, height = 2, size = width * height * 4;
            const data16 = Uint16Array.from({ length: size }, (_, index) => [0x1234, 0x5678, 0x9abc, 0x8001][index % 4]!);
            const image: RgbaImage = { width, height, data: Uint8Array.from(data16, value => Math.round(value / 257)), data16,
                format: "miff", space: channels <= 2 ? "b-w" : "srgb", hasAlpha: channels === 2 || channels === 4, channels, depth: "ushort", density: 72 };
            const meta = [0, 1].map(channel => {
                // Identical color pixels with changing meta samples must not collapse into one RLE run.
                const samples = Uint16Array.from({ length: size }, (_, index) => (Math.floor(index / 4) * 1237 + channel * 97) % 65536);
                return { ...image, data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: samples };
            });
            const source = Buffer.concat([image, ...meta].map(plane => depth === 16 ? new Uint8Array(plane.data16!.buffer) : plane.data));
            const retained = [image, ...meta].map((plane, index) => ({ ...plane, position: index * size, ...(depth === 16 ? { storedData16: { position: index * size * 2, length: size } } : {}) }));
            const borrowed = Buffer.alloc(8192);
            const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (position: number, length: number) => {
                borrowed.fill(0);
                borrowed.set(source.subarray(position, position + length));
                return borrowed.subarray(0, length);
            }) };
            const chunks: Uint8Array[] = [];
            for await (const chunk of encodeMiffFromStorage({ ...retained[0]!, storedMetaChannels: retained.slice(1) }, storage, new AbortController().signal, depth, compression)) chunks.push(chunk);
            expect(storage.read.mock.calls.every(([, length]) => length <= 8192)).toBe(true);
            const buffered = encodeMiffImage({ ...image, metaChannels: meta }, depth, compression);
            const selected = channels <= 2 ? image.hasAlpha ? [0, 3] : [0] : image.hasAlpha ? [0, 1, 2, 3] : [0, 1, 2];
            const expected = Array.from({ length: width * height }, (_, pixel) => [
                ...selected.map(channel => ({ plane: image, index: pixel * 4 + channel })),
                ...meta.map(plane => ({ plane, index: pixel * 4 })),
            ].flatMap(({ plane, index }) => depth === 8 ? [plane.data[index]!] : [plane.data16![index]! >>> 8, plane.data16![index]! & 255])).flat();
            for (const bytes of [buffered, Buffer.concat(chunks)]) {
                const end = bytes.indexOf(26);
                expect(new TextDecoder().decode(bytes.subarray(0, end))).toContain(`number-channels=${channels + 2} number-meta-channels=2`);
                if (compression === "none" || compression === "rle") expect([...bytes.subarray(end + 1)]).toEqual(expected);
                if (nativeMagick) for (const [index, plane] of meta.entries()) {
                    const decoded = spawnSync("magick", ["miff:-", "-channel", `Meta${index}`, "-separate", "-depth", String(depth), "-endian", "MSB", "gray:-"], { input: bytes });
                    expect(decoded.status, decoded.stderr.toString()).toBe(0);
                    expect([...decoded.stdout]).toEqual(Array.from({ length: width * height }, (_, pixel) => depth === 8 ? [plane.data[pixel * 4]!] : [plane.data16![pixel * 4]! >>> 8, plane.data16![pixel * 4]! & 255]).flat());
                }
            }
        });
    }
}
