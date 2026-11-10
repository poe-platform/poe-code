import { expect, it } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";

function fixture(page?: string) {
    return new Uint8Array([...new TextEncoder().encode(`id=ImageMagick\nclass=DirectClass columns=1 rows=1 depth=8\n${page === undefined ? "" : `page=${page}`}\n:\x1a`), 18, 52, 86]);
}

it.each([
    ["8x6+2+1", { width: 8, height: 6, x: 2, y: 1 }],
    ["8x6-2-1", { width: 8, height: 6, x: -2, y: -1 }],
    ["0x0+0+0", { width: 0, height: 0, x: 0, y: 0 }],
    [undefined, undefined]
] as const)("retains MIFF canvas %s without changing the raster", async (page, virtualCanvas) => {
    const bytes = fixture(page), image = decodeMiffImage(bytes);
    expect(image.virtualCanvas).toEqual(virtualCanvas);
    expect(image).toMatchObject({ width: 1, height: 1 });
    expect([...image.data]).toEqual([18, 52, 86, 255]);
    const backing = new Uint8Array(4);
    const storage = {
        allocate() { return 0; },
        async read(offset: number, length: number) { return backing.subarray(offset, offset + length); },
        async write(offset: number, bytes: Uint8Array) { backing.set(bytes, offset); }
    };
    const stored = await decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, storage, new AbortController().signal);
    expect(stored.virtualCanvas).toEqual(virtualCanvas);
    expect(stored).toMatchObject({ width: 1, height: 1 });
    expect(backing).toEqual(image.data);
});

it("reads each selected frame's canvas", () => {
    const bytes = new Uint8Array([...fixture("8x6+2+1"), ...fixture("4x3-1+2")]);
    expect(readMiffHeader(bytes).metadata.virtualCanvas).toEqual({ width: 8, height: 6, x: 2, y: 1 });
    expect(readMiffHeader(bytes, 1).metadata.virtualCanvas).toEqual({ width: 4, height: 3, x: -1, y: 2 });
});
