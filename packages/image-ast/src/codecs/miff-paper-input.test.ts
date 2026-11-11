import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeMiffImage, readMiffHeader } from "./miff-input.js";
import { decodeMiffToStorage } from "./miff-input-storage.js";
import fixtures from "./miff-paper-fixtures.json";

// Native ImageMagick 7.1.2-35 Q16-HDRI generated these complete MIFF files with
// the recorded args from P6 7x5 input: RGB byte i = (13 * i + 9) % 256.
// stdout and RGBA hashes come from reading those same bytes with native magick.
it.each(fixtures)("resolves native MIFF paper metadata: $name", async ({ miff, stdout, rgbaHash }) => {
    const bytes = Buffer.from(miff, "base64"), image = decodeMiffImage(bytes);
    const header = readMiffHeader(bytes).metadata;
    const backing = new Uint8Array(image.width * image.height * 12);
    let allocated = 0;
    const stored = await decodeMiffToStorage({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, {
        allocate(length) { const position = allocated; allocated += length; return position; },
        async read(offset, length) { return backing.subarray(offset, offset + length); },
        async write(offset, data) { backing.set(data, offset); }
    }, new AbortController().signal);
    for (const metadata of [header, image, stored]) {
        const page = metadata.virtualCanvas!;
        expect(`${metadata.width}x${metadata.height}|${page.width}x${page.height}${page.x < 0 ? "" : "+"}${page.x}${page.y < 0 ? "" : "+"}${page.y}`).toBe(stdout);
    }
    expect(createHash("sha256").update(image.data).digest("hex")).toBe(rgbaHash);
    expect(backing.subarray(stored.position, stored.position + image.data.length)).toEqual(image.data);
});
