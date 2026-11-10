import { expect, it, vi } from "vitest";
import { decodeMiffImage } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

function fixture(fields: string, packets: number[]) {
    return new Uint8Array([...new TextEncoder().encode(`id=ImageMagick\nclass=DirectClass columns=1 rows=1 depth=8 colorspace=sRGB compression=RLE\n${fields}\n:\x1a`), ...packets]);
}

it.each([
    ["", [18, 52, 86, 0], [18, 52, 86, 255]],
    ["colorspace=Gray", [42, 0], [42, 42, 42, 255]],
    ["colorspace=Gray matte=True", [42, 128, 0], [42, 42, 42, 128]]
] as const)("decodes RLE channel layout %s", (fields, packets, expected) => {
    expect([...decodeMiffImage(fixture(fields, [...packets])).data]).toEqual(expected);
});

for (const [packets, message] of [
    [[18, 52], "Truncated MIFF raster"],
    [[18, 52, 86], "Truncated MIFF raster"],
    [[18, 52, 86, 1], "MIFF run exceeds raster"]
] as const) it(`rejects malformed RLE ${packets} in both decoders`, async () => {
    const bytes = fixture("", [...packets]);
    expect(() => decodeMiffImage(bytes)).toThrow(message);
    const storage = { allocate: () => 0, read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal)).rejects.toThrow(message);
    expect(storage.write).not.toHaveBeenCalled();
});

it("preserves 16-bit RLE runs across storage chunks and borrowed source pages", async () => {
    const sample = [1, 1, 4, 1, 128, 1, 255, 255];
    const bytes = fixture("columns=2050 depth=16 matte=True", [...sample, 0, ...Array.from({ length: 8 }, () => [...sample, 255]).flat(), ...sample, 0]);
    const backing = new Uint8Array(2050 * 12), borrowed = new Uint8Array(8192);
    let end = 0;
    const source = { size: bytes.length, async read(offset: number, length: number) {
        expect(length).toBeLessThanOrEqual(8192);
        borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length));
        return borrowed.subarray(0, length);
    } };
    const storage = {
        allocate(length: number) { const start = end; end += length; return start; },
        async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
        async write(offset: number, data: Uint8Array) { expect(data.length).toBeLessThanOrEqual(8192); backing.set(data, offset); }
    };
    const image = await decodeMiffToStorage(source, storage, new AbortController().signal);
    const high = new Uint16Array(backing.buffer, image.storedData16!.position, image.storedData16!.length);
    expect(high).toEqual(decodeMiffImage(bytes).data16);
    for (const pixel of [0, 1023, 1024, 2049]) expect([...high.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([257, 1025, 32769, 65535]);
});

it("enforces pixel limits before expanding RLE or allocating storage", async () => {
    const bytes = fixture("columns=256", [18, 52, 86, 255]);
    expect(() => decodeMiffImage(bytes, { limitInputPixels: 255 })).toThrow();
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal, { limitInputPixels: 255 })).rejects.toThrow();
    expect(storage.allocate).not.toHaveBeenCalled();
});

it("locates adjacent RLE frames by packet lengths", async () => {
    const first = fixture("columns=256", [18, 52, 86, 255]);
    const second = fixture("matte=True", [171, 205, 239, 128, 0]);
    const bytes = new Uint8Array([...first, ...second]);
    const image = decodeMiffImage(bytes, { page: 1 });
    expect(image).toMatchObject({ width: 1, height: 1, pages: 2 });
    expect([...image.data]).toEqual([171, 205, 239, 128]);
    const backing = new Uint8Array(4);
    const storage = {
        allocate: () => 0,
        async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
        async write(offset: number, data: Uint8Array) { backing.set(data, offset); }
    };
    const stored = await decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal, { page: 1 });
    expect(stored).toMatchObject({ width: 1, height: 1, pages: 2 });
    expect([...backing]).toEqual([171, 205, 239, 128]);
});
