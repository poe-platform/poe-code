import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { decodeImage, encodeImage, type RgbaImage } from "./index.js";
import { encodeStoredImage } from "./image-encode.js";

const image: RgbaImage = { width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255),
  format: "raw", channels: 4, hasAlpha: false, space: "srgb", depth: "uchar", density: 72 };

it.each([undefined, "/icons/app-icon.xpm"])("names both XPM encoders from %s", async outputFilename => {
  const options = { format: "xpm" as const, ...(outputFilename === undefined ? {} : { outputFilename }) };
  const expected = encodeImage(image, options).data, chunks: Uint8Array[] = [];
  for await (const chunk of encodeStoredImage({ ...image, position: 0 }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read(position, length) { return image.data.slice(position, position + length); },
    async write() { throw new Error("Unexpected write"); },
  }, new AbortController().signal, options)) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
  expect(new TextDecoder().decode(expected)).toContain(`static char *${outputFilename ? "app_icon" : "image"}[]`);
  expect(decodeImage(expected).data).toEqual(image.data);
});

it.each([true, false])("uses the file name without leaking it into buffer output (retained=%s)", async retained => {
  const filesystem = new MemoryFileSystem();
  const output = sharp(encodeImage(image, { format: "xpm" }).data, {
    filesystem: retained ? filesystem : { readFile: filesystem.readFile.bind(filesystem), writeFile: filesystem.writeFile.bind(filesystem) }
  });
  await output.toFile("/app-icon.xpm");
  expect(new TextDecoder().decode(await filesystem.readFile("/app-icon.xpm"))).toContain("static char *app_icon[]");
  expect(new TextDecoder().decode(await output.toBuffer())).toContain("static char *image[]");
});
