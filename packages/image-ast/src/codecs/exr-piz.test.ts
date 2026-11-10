import { expect, it } from "vitest";
import { unpackExrPiz } from "./exr-piz.js";
import { decodeExrImage, readExrHeader } from "./exr.js";
import fixtures from "../../../../tests/fixtures/media/exr-piz-fixtures.json" with { type: "json" };

// Native OpenEXR 3.5.3 PIZ/ZIP pairs. ramp is the original 64x64 ImageMagick
// red-blue gradient. Other cases exercise mixed sample types, partial blocks,
// odd dimensions, the 16-bit wavelet, zero bitmaps and uncompressed fallback.
for (const fixture of fixtures) {
    it(`decodes every PIZ sample like ZIP (${fixture.name})`, () => {
        const piz = new Uint8Array(Buffer.from(fixture.piz, "base64"));
        const zip = new Uint8Array(Buffer.from(fixture.zip, "base64"));
        expect(readExrHeader(piz).compression).toBe(4);
        const expected = decodeExrImage(zip), actual = decodeExrImage(piz);
        expect([actual.width, actual.height, actual.channels]).toEqual([expected.width, expected.height, expected.channels]);
        for (const key of ["data", "data16", "dataFloat"] as const) {
            const a = actual[key]!, b = expected[key]!;
            expect(Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(0);
        }
    });
}

for (const damage of ["bitmap", "length", "symbol-range", "table-size", "bit-count", "zero-run", "codes", "output-size"] as const) {
    it(`rejects invalid PIZ ${damage}`, () => {
        const bytes = Buffer.from(fixtures.find(fixture => fixture.name === "ramp")!.piz, "base64");
        const header = readExrHeader(bytes), chunk = Number(bytes.readBigUInt64LE(header.offset));
        const packed = bytes.subarray(chunk + 8, chunk + 8 + bytes.readUInt32LE(chunk + 4));
        const table = 8 + packed.readUInt16LE(2) - packed.readUInt16LE(0) + 1;
        if (damage === "bitmap") packed.writeUInt16LE(8192, 2);
        if (damage === "length") packed.writeUInt32LE(0xffffffff, table - 4);
        if (damage === "symbol-range") packed.writeUInt32LE(65537, table + 4);
        if (damage === "table-size") packed.writeUInt32LE(0xffffffff, table + 8);
        if (damage === "bit-count") packed.writeUInt32LE(0xffffffff, table + 12);
        if (damage === "zero-run") { packed.writeUInt32LE(packed.readUInt32LE(table), table + 4); packed[table + 20] = 0xfc; }
        if (damage === "codes") packed[table + 20] = 0x08;
        expect(() => unpackExrPiz(packed, 64, damage === "output-size" ? 1 : 32, header.channels)).toThrow("EXR PIZ");
    });
}

it("checks the pixel limit before decoding PIZ chunks", () => {
    expect(() => decodeExrImage(Buffer.from(fixtures[0]!.piz, "base64"), { limitInputPixels: 1 })).toThrow("pixel limit");
});
