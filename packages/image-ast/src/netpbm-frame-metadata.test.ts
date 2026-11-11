import { expect, it } from "vitest";
import { readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";

const first = Buffer.from("P5\n#first\n1 1\n255\n\x11");
for (const [magic, frame, expected] of [
    ["P1", "P1\n#second\n2 1\n01\n", { format: "pbm", channels: 1, bitsPerSample: 1 }],
    ["P2", "P2\n#second\n2 1\n15\n5 6\n", { format: "pgm", channels: 1, bitsPerSample: 4 }],
    ["P3", "P3\n#second\n2 1\n255\n0 0 0 0 0 0\n", { format: "ppm", channels: 3, bitsPerSample: 8 }],
    ["P4", "P4\n#second\n2 1\n\x00", { format: "pbm", channels: 1, bitsPerSample: 1 }],
    ["P5", "P5\n#second\n2 1\n255\n\x55\x66", { format: "pgm", channels: 1, bitsPerSample: 8 }],
    ["P6", "P6\n#second\n2 1\n255\n\x00\x00\x00\x00\x00\x00", { format: "ppm", channels: 3, bitsPerSample: 8 }],
    ["P7", "P7\n#second\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n\x00\x00\x00\x00\x00\x00\x00\x00", { format: "pam", channels: 4, bitsPerSample: 8 }]
] as const) {
    for (const route of ["buffer", "source"] as const) {
        it(`reads selected ${magic} metadata through ${route}`, async () => {
            const bytes = Buffer.concat([first, Buffer.from(frame)]);
            const read = (page?: number) => route === "buffer" ? readImageMetadata(bytes, { page }) : readImageMetadataFromSource({
                size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); }
            }, new AbortController().signal, { page });
            expect(await read()).toMatchObject({ width: 1, height: 1, pages: 2, properties: { comment: "first\n" } });
            expect(await read(1)).toMatchObject({ ...expected, width: 2, height: 1, properties: { comment: "second\n" } });
            expect(await read(0)).toMatchObject({ width: 1, height: 1, properties: { comment: "first\n" } });
        });
    }
}
