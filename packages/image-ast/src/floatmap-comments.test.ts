import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";

for (const format of ["pfm", "phm"] as const) for (const color of [false, true]) {
    for (const newline of ["\n", "\r\n"]) it(`reads ${format} header comments, color=${color}, newline=${JSON.stringify(newline)}`, async () => {
        const magic = format === "pfm" ? color ? "PF" : "Pf" : color ? "PH" : "Ph";
        const raster = Buffer.from(format === "pfm" ? "3e0000003f000000" : "30003800", "hex");
        const payload = color ? Buffer.concat([raster, raster, raster]) : raster;
        const plain = Buffer.concat([Buffer.from(`${magic}\n2 1\n1.0\n`), payload]);
        const header = [magic, "#my note", "#second note", "2", "#height", "1", "#scale", "1.0", ""].join(newline);
        const bytes = Buffer.concat([Buffer.from(header), payload]);
        const expected = { width: 2, height: 1, properties: { comment: "my note\nsecond note\nheight\nscale\n" } };
        expect(readImageMetadata(bytes)).toMatchObject(expected);
        const image = decodeImage(bytes);
        expect(image).toMatchObject(expected);
        expect(image.data).toEqual(decodeImage(plain).data);
        expect(image.data16).toEqual(decodeImage(plain).data16);
        const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
        expect(await readImageMetadataFromSource(source, new AbortController().signal)).toEqual(readImageMetadata(bytes));
    });
}

for (const magic of ["Pf", "Ph"]) {
    it(`does not consume ${magic} raster bytes that look like a comment`, () => {
        const bytes = Buffer.concat([Buffer.from(`${magic}\n1 1\n1.0\n`), Buffer.from(magic === "Pf" ? "23200a00" : "2320", "hex")]);
        expect(readImageMetadata(bytes)).not.toHaveProperty("properties.comment");
        expect(decodeImage(bytes).data).toHaveLength(4);
    });
    it(`rejects an unterminated ${magic} header comment`, () => {
        expect(() => readImageMetadata(Buffer.from(`${magic}\n#no dimensions`))).toThrow(`Truncated ${magic === "Pf" ? "PFM" : "PHM"} header`);
    });
}
