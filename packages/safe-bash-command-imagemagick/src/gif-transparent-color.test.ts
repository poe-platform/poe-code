import { expect, it } from "vitest";
import { decodeGifImage, decodeGifToStorage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const source = Buffer.from("R0lGODlhCQALAIEAABEhMf8AAADIAAAA3CH+C3NvdXJjZSBub3RlACH5BAEAAAAALAAAAAAJAAsAAAgmAAEEEDBAIEEABwcWHGhw4cGEEBtKhOhQokKEDitevEjRoMWDAQEAOw==", "base64");

for (const retained of [false, true]) for (const coalesce of [false, true]) {
  it(`decodes the RGB of transparent GIF pixels, retained=${retained}, coalesce=${coalesce}`, async () => {
    const memory = new Uint8Array(4096);
    let end = 0;
    const storage = {
      allocate(length: number) { const at = end; end += length; return at; },
      async read(at: number, length: number) { return memory.slice(at, at + length); },
      async write(at: number, bytes: Uint8Array) { memory.set(bytes, at); }
    };
    const image = retained
      ? await decodeGifToStorage({ size: source.length, async read(at, length) { return source.subarray(at, at + length); } }, storage, new AbortController().signal, { coalesce })
      : decodeGifImage(source, { coalesce });
    const data = "position" in image ? await storage.read(image.position, image.width * image.height * 4) : image.data;
    const transparent = [];
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] === 0) transparent.push(Array.from(data.subarray(at, at + 4)));
    }
    expect(transparent).toEqual(Array.from({ length: 28 }, () => [17, 33, 49, 0]));
  });
}

for (const retained of [false, true]) {
  it(`normalizes transparent GIF colors during default palette conversion, retained=${retained}`, async () => {
    const files = new Map([["/alpha.gif", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/alpha.gif", source);
    const result = await runConvertCli(["/alpha.gif", "/out.gif"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = retained ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
    // Inspect the palette independently of our decoder: the encoder reserves index 255.
    expect(Array.from(bytes.subarray(13 + 255 * 3, 13 + 256 * 3))).toEqual([0, 0, 0]);
    const image = decodeGifImage(bytes);
    const expected = decodeGifImage(source).data;
    // Native ImageMagick's default palette conversion makes hidden RGB black.
    for (let at = 0; at < expected.length; at += 4) {
      if (expected[at + 3] === 0) expected.fill(0, at, at + 3);
    }
    expect(image.data).toEqual(expected);
    let transparent = 0;
    for (let at = 0; at < image.data.length; at += 4) {
      if (image.data[at + 3] !== 0) continue;
      expect(Array.from(image.data.subarray(at, at + 4))).toEqual([0, 0, 0, 0]);
      transparent++;
    }
    expect(transparent).toBe(28);
  });
}
