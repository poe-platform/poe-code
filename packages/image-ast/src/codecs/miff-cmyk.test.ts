import { expect, it, vi } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

function fixture(depth: number, alpha: boolean, width = 1, extra = "") {
    const samples = [0x1234, 0x5678, 0x9abc, 0x3456, ...(alpha ? [0x8001] : [])];
    const pixels = samples.flatMap(value => depth === 8 ? [value >>> 8] : [value >>> 8, value & 255]);
    return new Uint8Array([...new TextEncoder().encode(`id=ImageMagick\nclass=DirectClass colorspace=CMYK compression=None\ncolumns=${width} rows=1 depth=${depth} matte=${alpha}\nnumber-channels=${alpha ? 5 : 4}\n${extra}\f\n:\x1a`), ...Array.from({ length: width }, () => pixels).flat()]);
}

for (const depth of [8, 16]) for (const alpha of [false, true]) {
    it(`preserves original inks separately from opacity and RGB backing, depth=${depth}, alpha=${alpha}`, async () => {
        const bytes = fixture(depth, alpha, 2050);
        const image = decodeMiffImage(bytes);
        expect(image).toMatchObject({ space: "cmyk", channels: alpha ? 5 : 4, hasAlpha: alpha, bitsPerSample: depth });
        const inks = [0x1234, 0x5678, 0x9abc, 0x3456].map(value => depth === 8 ? (value >>> 8) / 255 : value / 65535);
        const rgba16 = [...inks.slice(0, 3).map(value => Math.round((1 - value) * (1 - inks[3]!) * 65535)), alpha ? depth === 8 ? 0x8080 : 0x8001 : 65535];
        expect([...image.hueSamples!.subarray(0, 4)]).toEqual(inks);
        expect([...image.data16!.subarray(0, 4)]).toEqual(rgba16);
        const backing = new Uint8Array(2050 * 44), borrowed = new Uint8Array(8192);
        let end = 0;
        const source = { size: bytes.length, read: async (offset: number, length: number) => {
            expect(length).toBeLessThanOrEqual(8192);
            borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length));
            return borrowed.subarray(0, length);
        } };
        const storage = {
            allocate(length: number) { const position = end; end += length; return position; },
            async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
            async write(offset: number, data: Uint8Array) { backing.set(data, offset); }
        };
        const stored = await decodeMiffToStorage(source, storage, new AbortController().signal);
        expect(stored).toMatchObject({ space: "cmyk", channels: image.channels, hasAlpha: alpha });
        expect(backing.subarray(stored.position, stored.position + image.data.length)).toEqual(image.data);
        expect(new Uint16Array(backing.slice(stored.storedData16!.position, stored.storedData16!.position + image.data16!.byteLength).buffer)).toEqual(image.data16);
        expect(new Float64Array(backing.slice(stored.storedHueSamples!, stored.storedHueSamples! + image.hueSamples!.byteLength).buffer)).toEqual(image.hueSamples);
    });
}

it("scans mixed CMYK and CMYKA frame strides", () => {
    const bytes = new Uint8Array([...fixture(8, false), ...fixture(16, true)]);
    expect(readMiffHeader(bytes).metadata).toMatchObject({ pages: 2, channels: 4 });
    expect(decodeMiffImage(bytes, { page: 1 })).toMatchObject({ pages: 2, channels: 5, bitsPerSample: 16 });
});

it.each(["number-channels=4", "class=PseudoClass colors=1", "number-meta-channels=1"])("rejects unsupported CMYKA layout %s before allocation", async extra => {
    const bytes = fixture(8, true, 1, extra + "\n");
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal)).rejects.toThrow("Unsupported MIFF encoding");
    expect(storage.allocate).not.toHaveBeenCalled();
});
