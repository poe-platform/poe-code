import { expect, it, vi } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

function fixture(depth: number, raster: string, fields = "") {
    return Buffer.concat([Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass columns=1 rows=1 depth=${depth}\ncolorspace=Gray quantum:format=floating-point\n${fields}\n\f\n:\x1a`), Buffer.from(raster, "hex")]);
}

it.each<[number, string, number]>([
    [16, "0001", 0], [16, "0100", 1], [16, "3800", 32768], [16, "bc00", 0],
    [16, "7c00", 65535], [16, "fc00", 0], [16, "7e00", 0],
    [32, "3f000000", 32768], [32, "bf800000", 0], [32, "40000000", 65535],
    [32, "7f800000", 65535], [32, "ff800000", 0], [32, "7fc00000", 0]
])("decodes %s-bit gray sample %s with implicit opaque alpha", (depth, raster, expected) => {
    const image = decodeMiffImage(fixture(depth, raster));
    expect(image).toMatchObject({ depth: "float", bitsPerSample: depth, channels: 1 });
    expect([...image.data16!]).toEqual([expected, expected, expected, 65535]);
});

it.each([16, 32])("decodes %s-bit float chunks and selects mixed-depth frames", async depth => {
    const pixel = depth === 16 ? "38003800" : "3f0001803f000000";
    const frame = fixture(depth, pixel.repeat(2050), "columns=2050 alpha-trait=Blend");
    const bytes = Buffer.concat([frame, fixture(depth === 16 ? 32 : 16, depth === 16 ? "3f800000" : "3c00")]);
    const image = decodeMiffImage(bytes);
    expect(readMiffHeader(bytes).metadata).toMatchObject({ pages: 2 });
    expect([...decodeMiffImage(bytes, { page: 1 }).data16!]).toEqual([65535, 65535, 65535, 65535]);
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
    expect(backing.subarray(stored.position, stored.position + image.data.length)).toEqual(image.data);
    expect(new Uint16Array(backing.buffer, stored.storedData16!.position, stored.storedData16!.length)).toEqual(image.data16);
    expect([...image.data16!.subarray(0, 4)]).toEqual([depth === 16 ? 32768 : 32769, depth === 16 ? 32768 : 32769, depth === 16 ? 32768 : 32769, 32768]);
    const truncated = frame.subarray(0, frame.length - 1);
    const untouched = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    expect(() => decodeMiffImage(truncated)).toThrow("Truncated MIFF raster");
    await expect(decodeMiffToStorage({ size: truncated.length, read: async (offset, length) => truncated.subarray(offset, offset + length) }, untouched, new AbortController().signal)).rejects.toThrow("Truncated MIFF raster");
    expect(untouched.allocate).not.toHaveBeenCalled();
});
