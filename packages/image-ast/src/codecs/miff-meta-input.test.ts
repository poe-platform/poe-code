import { expect, it, vi } from "vitest";
import fixtures from "./miff-meta-fixtures.json";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

it("keeps extra planes aligned across chunks and adjacent frames in caller storage", async () => {
    const fixture = fixtures.find(item => item.depth === 16 && item.compression === "None")!;
    const original = Buffer.from(fixture.input, "hex"), { offset } = readMiffHeader(original);
    const header = Buffer.from(original.subarray(0, offset).toString().replace("columns=4", "columns=4100"));
    const first = Buffer.concat([header, ...Array.from({ length: 1025 }, () => original.subarray(offset))]);
    const bytes = Buffer.concat([first, Buffer.from(fixtures[1]!.input, "hex")]);
    const image = decodeMiffImage(bytes);
    expect(image).toMatchObject({ width: 4100, height: 2, pages: 2 });
    expect(image.metaChannels).toHaveLength(2);
    expect(decodeMiffImage(bytes, { page: 1 }).metaChannels).toHaveLength(1);
    const backing = new Uint8Array(8200 * 12 * 3), borrowed = new Uint8Array(8192);
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
    expect(stored.storedMetaChannels).toHaveLength(2);
    for (const [index, plane] of image.metaChannels!.entries()) {
        const retained = stored.storedMetaChannels![index]!;
        expect(backing.subarray(retained.position, retained.position + plane.data.length)).toEqual(plane.data);
        expect(new Uint16Array(backing.slice(retained.storedData16!.position, retained.storedData16!.position + plane.data16!.byteLength).buffer)).toEqual(plane.data16);
        for (const pixel of [0, 1023, 1024, 8199]) {
            const expected = parseInt(fixture.meta[index]!.slice(pixel % 8 * 4, pixel % 8 * 4 + 4), 16);
            expect([...plane.data16!.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([expected, expected, expected, 65535]);
        }
    }
});

it.each(["-1", "1.5", "NaN", "Infinity", "64", "9007199254740991"])("rejects invalid meta channel count %s before allocation", async count => {
    const original = Buffer.from(fixtures[2]!.input, "hex");
    const end = original.indexOf(26) + 1;
    const bytes = Buffer.concat([Buffer.from(original.subarray(0, end).toString().replace("number-meta-channels=2", `number-meta-channels=${count}`)), original.subarray(end)]);
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal)).rejects.toThrow("Unsupported MIFF encoding");
    expect(storage.allocate).not.toHaveBeenCalled();
});

it("rejects a truncated extra plane before allocating storage", async () => {
    const original = Buffer.from(fixtures[2]!.input, "hex"), bytes = original.subarray(0, original.length - 1);
    const storage = { allocate: vi.fn(), read: vi.fn(), write: vi.fn() };
    await expect(decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal)).rejects.toThrow("Truncated MIFF raster");
    expect(storage.allocate).not.toHaveBeenCalled();
});
