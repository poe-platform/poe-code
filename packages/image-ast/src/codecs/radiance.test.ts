import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./index.js";

function hdr(raster: number[], resolution = "-Y 1 +X 2", format = "32-bit_rle_rgbe") {
    return new Uint8Array([...new TextEncoder().encode(`#?RGBE\r\nFORMAT=${format}\r\n\r\n${resolution}\r\n`), ...raster]);
}

it("reads flat RGBE, black exponents, and values above one without applying gamma", () => {
    const bytes = hdr([128, 64, 32, 130, 255, 255, 255, 0]);
    expect(readImageMetadata(bytes)).toMatchObject({ format: "hdr", width: 2, height: 1, channels: 3, hasAlpha: false, magickColorspace: "RGB", gamma: 1 });
    const image = decodeImage(bytes);
    expect(Array.from(image.dataFloat!)).toEqual([2, 1, .5, 1, 0, 0, 0, 1]);
    expect(Array.from(image.data16!)).toEqual([65535, 65535, 32768, 65535, 0, 0, 0, 65535]);
});

it("reads 01 01 01 triplets as literal flat pixels, including the first pixel", () => {
    const image = decodeImage(hdr([1, 1, 1, 129, 128, 0, 0, 129, 1, 1, 1, 2, 0, 0, 128, 130], "-Y 2 +X 2"));
    expect(Array.from(image.dataFloat!)).toEqual([1 / 128, 1 / 128, 1 / 128, 1, 1, 0, 0, 1, 2 ** -134, 2 ** -134, 2 ** -134, 1, 0, 0, 2, 1]);
});

it("decodes modern RLE runs and literals", () => {
    const image = decodeImage(hdr([2, 2, 0, 8, 136, 128, 8, 0, 16, 32, 48, 64, 80, 96, 112, 136, 0, 136, 129], "-Y 1 +X 8"));
    expect(Array.from(image.dataFloat!)).toEqual(Array.from({ length: 8 }, (_, i) => [1, i / 8, 0, 1]).flat());
});

for (const resolution of ["-Y 2 +X 2", "+Y 2 -X 2", "+X 2 -Y 2", "-X 2 +Y 2"]) {
    it(`honors axis order and direction ${resolution}`, () => {
        const pixels = [[128, 0, 0, 129], [0, 128, 0, 129], [0, 0, 128, 129], [128, 128, 128, 129]];
        const ordering = resolution === "-Y 2 +X 2" ? [0, 1, 2, 3] : resolution === "+Y 2 -X 2" ? [3, 2, 1, 0] : resolution === "+X 2 -Y 2" ? [0, 2, 1, 3] : [3, 1, 2, 0];
        expect(Array.from(decodeImage(hdr(ordering.flatMap(i => pixels[i]!), resolution)).data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    });
}

for (const [label, bytes] of [
    ["truncated", hdr([128, 0, 0, 129])],
    ["truncated after literal triplet", hdr([128, 0, 0, 129, 1, 1, 1, 5], "-Y 1 +X 6")],
    ["zero packet", hdr([2, 2, 0, 8, 0], "-Y 1 +X 8")],
    ["oversized packet", hdr([2, 2, 0, 8, 137, 128], "-Y 1 +X 8")],
    ["wrong scanline width", hdr([2, 2, 0, 9], "-Y 1 +X 8")],
    ["unsupported format", hdr([], "-Y 1 +X 2", "32-bit_rle_unknown")],
    ["invalid dimensions", hdr([], "-Y 0 +X 2")]
] as const) it(`rejects ${label}`, () => expect(() => decodeImage(bytes)).toThrow(/Radiance/));

it("checks input pixel limits before allocating pixels", () => {
    expect(() => decodeImage(hdr([], "-Y 100000 +X 100000"), { limitInputPixels: 100 })).toThrow("pixel limit");
});

for (const [encoding, raster] of [
    ["flat", Array.from({ length: 8 }, () => [128, 0, 0, 129]).flat()],
    ["planar RLE", [2, 2, 0, 8, 136, 128, 136, 0, 136, 0, 136, 129]],
] as const) it(`converts XYZ channels to sRGB for ${encoding}`, () => {
    const bytes = hdr([...raster], "-Y 1 +X 8", "32-bit_rle_xyze");
    expect(readImageMetadata(bytes)).toMatchObject({ format: "hdr", width: 8, height: 1, hasAlpha: false });
    const image = decodeImage(bytes);
    expect(Array.from(image.data)).toEqual(Array.from({ length: 8 }, () => [255, 0, 255, 255]).flat());
    expect(image.dataFloat![0]).toBeGreaterThan(1);
    expect(image.dataFloat![2]).toBeGreaterThan(1);
});

it("decodes a zero XYZE exponent as opaque black", () => {
    const image = decodeImage(hdr([128, 64, 32, 0], "-Y 1 +X 1", "32-bit_rle_xyze"));
    expect(Array.from(image.dataFloat!)).toEqual([0, 0, 0, 1]);
});
