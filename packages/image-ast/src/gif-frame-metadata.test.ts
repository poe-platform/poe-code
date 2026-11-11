import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { readImageMetadata } from "./codecs/index.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";

// 3x3 red followed by 1x1 blue at +1+1 on the same logical screen.
const bytes = Buffer.from("R0lGODlhAwADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAwADAAACA4R/BQAh+QQAFAAAACwBAAEAAQABAIAAAP8AAAACAkQBADs=", "base64");

it.each([
    { options: { page: 1 }, expected: { width: 3, height: 3 } },
    { options: { animated: true }, expected: { width: 3, height: 6, pageHeight: 3 } },
    { options: { coalesce: false }, expected: { width: 3, height: 3, virtualCanvas: { width: 3, height: 3, x: 0, y: 0 } } },
    { options: { page: 1, coalesce: false }, expected: { width: 1, height: 1, virtualCanvas: { width: 3, height: 3, x: 1, y: 1 } } },
    { options: { page: 1, animated: true, coalesce: false }, expected: { width: 1, height: 1, virtualCanvas: { width: 3, height: 3, x: 1, y: 1 } } }
])("reads GIF frame metadata with $options", async ({ options, expected }) => {
    const fs = new MemoryFileSystem(), signal = new AbortController().signal;
    const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal });
    try {
        const metadata = readImageMetadata(bytes, options);
        expect(metadata).toMatchObject({ ...expected, pages: 2 });
        const { storedDelay, ...retained } = await readImageMetadataFromSource({
            size: bytes.length,
            async read(at, length) { return bytes.subarray(at, at + length); }
        }, signal, options, storage);
        const delay = [];
        for (let i = 0; i < storedDelay!.length; i++) delay.push(await storedDelay!.at(i));
        expect({ ...retained, delay }).toEqual(metadata);
    } finally {
        await storage.close();
    }
});
