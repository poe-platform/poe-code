import { expect, it, vi } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

function fixture(fields = "", pixels = [255, 0, 0, 0, 0, 255, 1, 0]) {
    return new Uint8Array([...new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=PseudoClass colors=2\nnumber-channels=4 columns=2 rows=1 depth=8\ncolorspace=sRGB compression=None\n${fields}\n\f\n:\x1a`), ...pixels]);
}

it("expands palette indices in raster order and skips each palette when scanning frames", () => {
    const bytes = new Uint8Array([...fixture(), ...fixture("", [0, 255, 0, 255, 255, 255, 0, 1])]);
    expect(readMiffHeader(bytes).metadata).toMatchObject({ pages: 2, channels: 3, isPalette: true });
    expect([...decodeMiffImage(bytes).data]).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
    expect([...decodeMiffImage(bytes, { page: 1 }).data]).toEqual([0, 255, 0, 255, 255, 255, 255, 255]);
});

it("reads alpha after each index, separately from the RGB palette", () => {
    expect([...decodeMiffImage(fixture("matte=True number-channels=5", [0, 0, 0, 255, 0, 0, 1, 255, 0, 0])).data])
        .toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
});

it("preserves 16-bit palette and alpha samples in buffered and bounded retained decoding", async () => {
    const raster = Array.from({ length: 2050 }, () => [0, 1, 0x80, 1]).flat();
    const bytes = fixture("columns=2050 depth=16 matte=True number-channels=5", [0, 0, 0, 0, 0, 0, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, ...raster]);
    const image = decodeMiffImage(bytes);
    const backing = new Uint8Array(2050 * 12), borrowed = new Uint8Array(8192);
    let end = 0;
    const source = { size: bytes.length, read: async (offset: number, length: number) => {
        expect(length).toBeLessThanOrEqual(8192);
        borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length));
        return borrowed.subarray(0, length);
    } };
    const storage = {
        allocate(length: number) { const start = end; end += length; return start; },
        async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
        async write(offset: number, data: Uint8Array) { backing.set(data, offset); }
    };
    const stored = await decodeMiffToStorage(source, storage, new AbortController().signal);
    const samples = new Uint16Array(backing.buffer, stored.storedData16!.position, stored.storedData16!.length);
    expect(samples).toEqual(image.data16);
    for (const pixel of [0, 1023, 1024, 2049]) expect([...samples.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([0x1234, 0x5678, 0x9abc, 0x8001]);
    expect(backing.subarray(stored.position, stored.position + 2050 * 4)).toEqual(image.data);
});

it.each(["colors=-1", "colors=1.5", "colors=65537", "colors=Infinity"])("rejects invalid palette size %s", fields => {
    expect(() => decodeMiffImage(fixture(fields))).toThrow("Unsupported MIFF encoding");
});

it("rejects truncated palettes, truncated indices, and out-of-range indices", () => {
    expect(() => decodeMiffImage(fixture("", [255, 0, 0]))).toThrow("Truncated MIFF");
    expect(() => decodeMiffImage(fixture("", [255, 0, 0, 0, 0, 255, 0]))).toThrow("Truncated MIFF");
    expect(() => decodeMiffImage(fixture("", [255, 0, 0, 0, 0, 255, 2, 0]))).toThrow("Invalid MIFF palette index");
});

it("checks input pixel limits before allocating storage for indexed input", async () => {
    const bytes = fixture(), storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal, { limitInputPixels: 1 })).rejects.toThrow();
    expect(storage.allocate).not.toHaveBeenCalled();
});

it("retains sequence durations and the selected frame's native tick rate", () => {
    const bytes = new Uint8Array([...fixture("delay=1 ticks-per-second=24"), ...fixture("delay=7 ticks-per-second=1000")]);
    expect(decodeMiffImage(bytes, { page: 1 })).toMatchObject({ delay: [1000 / 24, 7], ticksPerSecond: 1000 });
});

it("uses RGB triplets for grayscale palettes", () => {
    expect([...decodeMiffImage(fixture("colorspace=Gray number-channels=2", [126, 126, 126, 255, 255, 255, 0, 1])).data])
        .toEqual([126, 126, 126, 255, 255, 255, 255, 255]);
});

it("reads two-byte indices when an 8-bit colormap has more than 256 entries", () => {
    const palette = new Array<number>(257 * 3).fill(0);
    palette[256 * 3] = 255;
    expect([...decodeMiffImage(fixture("colors=257", [...palette, 1, 0, 0, 0])).data])
        .toEqual([255, 0, 0, 255, 0, 0, 0, 255]);
});
