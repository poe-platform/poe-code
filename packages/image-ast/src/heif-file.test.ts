import { expect, it } from "vitest";
import sharp from "./index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
it.each(["heic", "heif", "avif"] as const)(
  "uses injected retained file I/O for %s input, output, metadata and overlays",
  async (format) => {
    const fs = new MemoryFileSystem(),
      pixels = Uint8Array.from({ length: 37 * 29 * 4 }, (_, i) => (i * 43) % 256),
      bytes = sharp(pixels, { raw: { width: 37, height: 29, channels: 4 } })
        .toFormat(format)
        .toBufferSync();
    await fs.writeFile("/in", bytes);
    await fs.writeFile("/overlay", bytes);
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
    const pipeline = (input: ReturnType<typeof sharp>, overlay: Uint8Array | string) =>
      input
        .resize(39, 33)
        .composite([{ input: overlay, left: 0, top: 0 }])
        .withMetadata({ density: 144, orientation: 6 })
        .toFormat(format);
    const expected = pipeline(sharp(bytes), bytes).toBufferWithObjectSync(),
      info = await pipeline(sharp("/in", { filesystem: guarded }), "/overlay").toFile("/out");
    const actual = await fs.readFile("/out");
    expect(info).toEqual({ ...expected.info, size: actual.length });
    expect(actual).toEqual(new Uint8Array(expected.data));
    expect(await sharp("/out", { filesystem: guarded }).metadata()).toEqual(
      sharp(actual).metadataSync()
    );
    expect((await fs.readdir("/")).map((e) => e.name).sort()).toEqual(["in", "out", "overlay"]);
  }
);

it.each(["cancel", "write"])(
  "keeps the destination and cleans retained storage after %s failure",
  async (phase) => {
    const fs = new MemoryFileSystem(),
      input = sharp({ create: { width: 531, height: 513, channels: 4, background: "red" } })
        .heif()
        .toBufferSync(),
      controller = new AbortController(),
      reason = new Error(phase);
    await fs.writeFile("/in", input);
    await fs.writeFile("/out", Uint8Array.of(42));
    let closed = 0;
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        if (key === "openReadFile")
          return async (...args: Parameters<typeof fs.openReadFile>) => {
            const handle = await fs.openReadFile(...args);
            return {
              ...handle,
              close: async () => {
                closed++;
                await handle.close();
              }
            };
          };
        if (key === "open")
          return async (...args: Parameters<typeof fs.open>) => {
            const handle = await fs.open(...args);
            return new Proxy(handle, {
              get(target, key) {
                if (key === "write")
                  return async () => {
                    if (phase === "cancel") {
                      controller.abort(reason);
                      controller.signal.throwIfAborted();
                    }
                    throw reason;
                  };
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
              }
            });
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    await expect(
      sharp("/in", { filesystem: guarded, signal: controller.signal }).avif().toFile("/out")
    ).rejects.toBe(reason);
    expect(await fs.readFile("/out")).toEqual(Uint8Array.of(42));
    expect(closed).toBe(1);
    expect((await fs.readdir("/")).map((e) => e.name).sort()).toEqual(["in", "out"]);
  }
);
