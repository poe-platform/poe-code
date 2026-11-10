import { expect, it } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { readMiffFromSource } from "./miff-input-storage.js";

function fixture(fields: string) {
    return new Uint8Array([
        ...new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=False\ncolumns=1 rows=1 depth=8\ncolorspace=sRGB compression=None\n${fields}\n\f\n:\x1a`),
        18, 52, 86,
    ]);
}

it.each([
    { fields: "", density: 72, resolution: undefined },
    { fields: "resolution=150x72 units=PixelsPerInch", density: 150, resolution: { x: 150, y: 72, unit: "inch" } },
    { fields: "resolution=150x72 units=PixelsPerCentimeter", density: 381, resolution: { x: 150, y: 72, unit: "cm" } },
    { fields: "resolution=150x72 units=Undefined", density: 150, resolution: { x: 150, y: 72, unit: "unknown" } },
])("retains MIFF resolution metadata: $fields", async ({ fields, density, resolution }) => {
    const bytes = fixture(fields);
    const source = { size: bytes.length, read: async (offset: number, length: number) => bytes.subarray(offset, offset + length) };
    const metadata = [readMiffHeader(bytes).metadata, decodeMiffImage(bytes), (await readMiffFromSource(source, new AbortController().signal)).metadata];
    for (const image of metadata) {
        expect(image.density).toBe(density);
        expect(image.resolution).toEqual(resolution);
    }
});

it("keeps the selected MIFF frame's resolution", () => {
    const bytes = new Uint8Array([
        ...fixture("resolution=150x72 units=PixelsPerInch"),
        ...fixture("resolution=40x30 units=PixelsPerCentimeter"),
        ...fixture(""),
    ]);
    expect(readMiffHeader(bytes, 0).metadata.resolution).toEqual({ x: 150, y: 72, unit: "inch" });
    expect(readMiffHeader(bytes, 1).metadata.resolution).toEqual({ x: 40, y: 30, unit: "cm" });
    expect(readMiffHeader(bytes, 2).metadata.resolution).toBeUndefined();
});
