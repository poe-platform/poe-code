import { expect, it, vi } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

function fixture(fields = "", pixels = [0x12, 0x34, 0x56]) {
    return new Uint8Array([...new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=False\ncolumns=1 rows=1 depth=8\ncolorspace=sRGB compression=None\n${fields}\n\f\n:\x1a`), ...pixels]);
}

it("preserves 16-bit samples including low bits and alpha", () => {
    const image = decodeMiffImage(fixture("depth=16 matte=True", [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x80, 0x01]));
    expect([...image.data16!]).toEqual([0x1234, 0x5678, 0x9abc, 0x8001]);
    expect([...image.data]).toEqual([18, 86, 154, 128]);
});

it("reads quoted properties without treating their contents as structural fields", () => {
    expect([...decodeMiffImage(fixture('label={columns=99 rows=99 :\x1a} comment="depth=32"')).data]).toEqual([18, 52, 86, 255]);
});

it("reads grayscale alpha", () => {
    expect([...decodeMiffImage(fixture("colorspace=Gray matte=True", [42, 128])).data]).toEqual([42, 42, 42, 128]);
});

it.each([0, 2, 256])("reads DirectClass RGB samples with colors=%s", colors => {
    expect([...decodeMiffImage(fixture(`colors=${colors}`)).data]).toEqual([18, 52, 86, 255]);
});

it.each(["compression=Zip", "class=PseudoClass", "depth=64", "depth=8 quantum:format=floating-point", "colorspace=CMYK", "profile:icc=10", "number-meta-channels=1"])("rejects unsupported layout %s", fields => {
    expect(() => decodeMiffImage(fixture(fields))).toThrow("Unsupported MIFF encoding");
});

it.each(["columns=0", "rows=-1", "columns=Infinity", "columns=9999999999999999"])("rejects invalid dimensions %s", fields => {
    expect(() => readMiffHeader(fixture(fields))).toThrow("Invalid MIFF dimensions");
});

it("rejects truncated pixels and enforces input limits before allocating storage", async () => {
    expect(() => decodeMiffImage(fixture("", [1]))).toThrow("Truncated MIFF raster");
    const bytes = fixture("columns=2", [1, 2, 3, 4, 5, 6]);
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal, { limitInputPixels: 1 })).rejects.toThrow();
    expect(storage.allocate).not.toHaveBeenCalled();
});

it("stops reading on cancellation", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    const source = { size: 100, read: vi.fn() }, storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage(source, storage, controller.signal)).rejects.toThrow("cancelled");
    expect(source.read).not.toHaveBeenCalled();
});

it.each([16, 32])("decodes retained %s-bit samples in bounded chunks without retaining borrowed bytes", async depth => {
    const samples = depth === 16 ? [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x80, 0x01]
        : [0x12, 0x34, 0x12, 0x34, 0x56, 0x78, 0x56, 0x78, 0x9a, 0xbc, 0x9a, 0xbc, 0x80, 0x01, 0x80, 0x01];
    const bytes = fixture(`columns=2050 depth=${depth} matte=True`, Array.from({ length: 2050 }, () => samples).flat());
    const backing = new Uint8Array(2050 * 12), borrowed = new Uint8Array(8192);
    let end = 0;
    const source = { size: bytes.length, read: vi.fn(async (offset: number, length: number) => {
        expect(length).toBeLessThanOrEqual(8192);
        borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length));
        return borrowed.subarray(0, length);
    }) };
    const storage = {
        allocate(length: number) { const start = end; end += length; return start; },
        async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
        async write(offset: number, data: Uint8Array) { backing.set(data, offset); }
    };
    const image = await decodeMiffToStorage(source, storage, new AbortController().signal);
    const high = new Uint16Array(backing.buffer, image.storedData16!.position, image.storedData16!.length);
    for (const pixel of [0, 1023, 1024, 2049]) {
        expect([...high.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([0x1234, 0x5678, 0x9abc, 0x8001]);
        expect([...backing.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([18, 86, 154, 128]);
    }
});

const mixedSequence = new Uint8Array([
    ...fixture("", [255, 0, 0]),
    ...fixture("columns=2 depth=16 matte=True", [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x80, 0x01, 0, 0, 0, 0, 255, 255, 255, 255]),
    ...fixture("colorspace=Gray", [42])
]);

it("counts adjacent frames and selects each frame's dimensions, depth and raster", async () => {
    expect(readMiffHeader(mixedSequence).metadata).toMatchObject({ pages: 3, width: 1, channels: 3, size: mixedSequence.length });
    const image = decodeMiffImage(mixedSequence, { page: 1 });
    expect(image).toMatchObject({ pages: 3, width: 2, height: 1, channels: 4, depth: "ushort" });
    expect([...image.data16!]).toEqual([0x1234, 0x5678, 0x9abc, 0x8001, 0, 0, 65535, 65535]);
    expect([...decodeMiffImage(mixedSequence, { page: 2 }).data]).toEqual([42, 42, 42, 255]);
    const backing = new Uint8Array(24);
    let end = 0;
    const storage = {
        allocate(length: number) { const start = end; end += length; return start; },
        async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
        async write(offset: number, data: Uint8Array) { backing.set(data, offset); }
    };
    const stored = await decodeMiffToStorage({ size: mixedSequence.length, read: async (offset, length) => mixedSequence.subarray(offset, offset + length) }, storage, new AbortController().signal, { page: 1 });
    expect(stored).toMatchObject({ pages: 3, width: 2, height: 1, channels: 4, depth: "ushort" });
    expect(backing.subarray(stored.position, stored.position + 8)).toEqual(image.data);
    expect(new Uint16Array(backing.buffer, stored.storedData16!.position, stored.storedData16!.length)).toEqual(image.data16);
});

it.each([-1, 0.5, 3, Infinity])("rejects unavailable MIFF page %s", page => {
    expect(() => decodeMiffImage(mixedSequence, { page })).toThrow("MIFF page out of range");
});

it("rejects truncated subsequent frames and checks selected frame limits before allocation", async () => {
    expect(() => decodeMiffImage(mixedSequence.subarray(0, mixedSequence.length - 1))).toThrow("Truncated MIFF raster");
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: mixedSequence.length, read: async (offset, length) => mixedSequence.subarray(offset, offset + length) }, storage, new AbortController().signal, { page: 1, limitInputPixels: 1 })).rejects.toThrow();
    expect(storage.allocate).not.toHaveBeenCalled();
});

it.each([false, true])("decodes unsigned 32-bit grayscale with alpha=%s and scans mixed-depth frames", alpha => {
    const samples = alpha ? [0, 0, 128, 1, 255, 255, 255, 255] : [0, 0, 128, 1];
    const frame = fixture(`depth=32 colorspace=Gray matte=${alpha} quantum:format=unsigned`, samples);
    const sequence = new Uint8Array([...frame, ...fixture()]);
    const image = decodeMiffImage(sequence);
    expect(image).toMatchObject({ pages: 2, depth: "uint", bitsPerSample: 32 });
    expect([...image.data16!]).toEqual([1, 1, 1, 65535]);
    expect([...decodeMiffImage(sequence, { page: 1 }).data]).toEqual([18, 52, 86, 255]);
    expect(() => decodeMiffImage(frame.subarray(0, frame.length - 1))).toThrow("Truncated MIFF raster");
});
