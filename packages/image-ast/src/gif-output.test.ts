import { expect, it } from "vitest";
import sharp from "./index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
it.each(["png", "ppm", "pgm", "pbm", "bmp", "tiff"] as const)(
  "streams GIF output from %s through caller storage",
  async (format) => {
    const fs = new MemoryFileSystem(),
      pixels = Uint8Array.from({ length: 37 * 29 * 4 }, (_, i) => (i * 43) % 256),
      bytes = sharp(pixels, { raw: { width: 37, height: 29, channels: 4 } })
        .toFormat(format)
        .toBufferSync();
    await fs.writeFile("/in", bytes);
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const pipeline = (image: ReturnType<typeof sharp>) =>
      image
        .resize(19, 13)
        .flip()
        .rotate(17)
        .gif({ delay: [12, 35], loop: 2 });
    const expected = pipeline(sharp(bytes)).toBufferWithObjectSync(),
      info = await pipeline(sharp("/in", { filesystem: guarded })).toFile("/out");
    const actual = await fs.readFile("/out");
    expect(info).toEqual({ ...expected.info, size: actual.length });
    expect(Buffer.compare(actual, expected.data)).toBe(0);
    expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["in", "out"]);
  }
);

import { encodeGifFromStorage } from "./codecs/gif-storage.js";
import { encodeGifImage } from "./codecs/gif.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
it.each([false, true])(
  "retained encoder preserves exact GIF bytes (animated=%s)",
  async (animated) => {
    const width = 37,
      height = 30,
      data = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 47) % 256),
      image = {
        width,
        height,
        data,
        format: "raw" as const,
        space: "srgb",
        channels: 4,
        depth: "uchar" as const,
        density: 72,
        hasAlpha: true
      },
      options = { ...(animated ? { pageHeight: 10 } : {}), delay: [12, 35], loop: 2 };
    const fs = new MemoryFileSystem(),
      signal = new AbortController().signal,
      storage = new PagedStorage({ fs, cwd: "/", env: {}, signal });
    try {
      const position = storage.allocate(data.length);
      await storage.write(position, data);
      const chunks: Uint8Array[] = [];
      for await (const chunk of encodeGifFromStorage(
        { ...image, position },
        storage,
        signal,
        options
      )) {
        expect(chunk.length).toBeLessThanOrEqual(4096);
        chunks.push(chunk);
      }
      expect(Buffer.compare(Buffer.concat(chunks), encodeGifImage(image, options))).toBe(0);
    } finally {
      await storage.close();
    }
  }
);
