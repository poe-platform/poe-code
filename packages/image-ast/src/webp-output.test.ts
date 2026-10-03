import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "./index.js";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { encodeWebpImage, readWebpMetadata } from "./codecs/webp.js";
import { encodeWebpFromStorage } from "./codecs/webp-storage.js";
import type { RgbaImage } from "./ast.js";
const vectors = [
  {
    width: 1,
    height: 1,
    alpha: false,
    density: 72,
    hash: "34c9f2a8b5dbf96d6c1f41fa8a91ad5b6b3587159c937bd6bf00af33665c9096",
    length: 182,
    metadata: {
      format: "webp",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      size: 182
    }
  },
  {
    width: 1,
    height: 1,
    alpha: false,
    density: 144,
    hash: "66016156470050a1d80af69452a299f58863d4a051eb2b01bbea6c5e2027570a",
    length: 286,
    metadata: {
      format: "webp",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      size: 286
    }
  },
  {
    width: 1,
    height: 1,
    alpha: true,
    density: 72,
    hash: "862dfecd1475475c12a27066d0e6b4b66bcf078942ee13dfa71703433c8000f8",
    length: 182,
    metadata: {
      format: "webp",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      size: 182
    }
  },
  {
    width: 1,
    height: 1,
    alpha: true,
    density: 144,
    hash: "f3fa8baa3ae0ed6dc1ff348bf1c88a94bb32ed508cda9acdbd3b9cdf05d66fa5",
    length: 286,
    metadata: {
      format: "webp",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      orientation: 6,
      size: 286
    }
  },
  {
    width: 7,
    height: 3,
    alpha: false,
    density: 72,
    hash: "9bd80a1e88a95b692e96d6f31236af976d982369aca1d1bbb7cff005eec504e6",
    length: 262,
    metadata: {
      format: "webp",
      width: 7,
      height: 3,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      size: 262
    }
  },
  {
    width: 7,
    height: 3,
    alpha: false,
    density: 144,
    hash: "51bad64f1be40d4abbfaa6e79ef7286f4dd2b44b0a28e296e01770fc3b185407",
    length: 366,
    metadata: {
      format: "webp",
      width: 7,
      height: 3,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      size: 366
    }
  },
  {
    width: 7,
    height: 3,
    alpha: true,
    density: 72,
    hash: "29a94f8cbc37e15b5545439d64e044b08a43c2be287a569981709d8d13fc18f9",
    length: 262,
    metadata: {
      format: "webp",
      width: 7,
      height: 3,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      size: 262
    }
  },
  {
    width: 7,
    height: 3,
    alpha: true,
    density: 144,
    hash: "9bd875c74e199175083f89117f6a57e668d7d52b66624c7e1f1e40d2f73bf222",
    length: 366,
    metadata: {
      format: "webp",
      width: 7,
      height: 3,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      orientation: 6,
      size: 366
    }
  },
  {
    width: 64,
    height: 17,
    alpha: false,
    density: 72,
    hash: "43c74ad4c4845aef4e2001d4bfa97c991adefd2b449ac96043ba68b3c2381c6a",
    length: 4530,
    metadata: {
      format: "webp",
      width: 64,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      size: 4530
    }
  },
  {
    width: 64,
    height: 17,
    alpha: false,
    density: 144,
    hash: "b78f66d169f13a8faefcd9fe8e3e0c1d321f0d2817369a016b414caa36c519d8",
    length: 4634,
    metadata: {
      format: "webp",
      width: 64,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      size: 4634
    }
  },
  {
    width: 64,
    height: 17,
    alpha: true,
    density: 72,
    hash: "774856c8e0658b78ded46ae10a581504a213654e993bbdbd9c5f3b5030ba4910",
    length: 4530,
    metadata: {
      format: "webp",
      width: 64,
      height: 17,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      size: 4530
    }
  },
  {
    width: 64,
    height: 17,
    alpha: true,
    density: 144,
    hash: "fd9cc73ee56b9013927eb62cbfb84319a843b803e917777756bf855071c78037",
    length: 4634,
    metadata: {
      format: "webp",
      width: 64,
      height: 17,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      orientation: 6,
      size: 4634
    }
  },
  {
    width: 257,
    height: 129,
    alpha: false,
    density: 72,
    hash: "4336d555e5dbc5d748a104b781b679da9e810b10811e0894cd3cfdb68b03c04d",
    length: 132790,
    metadata: {
      format: "webp",
      width: 257,
      height: 129,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      size: 132790
    }
  },
  {
    width: 257,
    height: 129,
    alpha: false,
    density: 144,
    hash: "fd672bda970691901d17f93b89af2c8473e6b42003c7619553e02286504e1b09",
    length: 132894,
    metadata: {
      format: "webp",
      width: 257,
      height: 129,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      orientation: 6,
      size: 132894
    }
  },
  {
    width: 257,
    height: 129,
    alpha: true,
    density: 72,
    hash: "262566d2a3f2f72aa8eecdc3fe8f4b5ba64403f53bce3be8df83e13e724e1805",
    length: 132790,
    metadata: {
      format: "webp",
      width: 257,
      height: 129,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      size: 132790
    }
  },
  {
    width: 257,
    height: 129,
    alpha: true,
    density: 144,
    hash: "bfac8fec5088d2aa18945393a8d21ef7e03052d34487b84fe74efc8d81fd5d51",
    length: 132894,
    metadata: {
      format: "webp",
      width: 257,
      height: 129,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      orientation: 6,
      size: 132894
    }
  }
];
function raster(v: (typeof vectors)[number]): RgbaImage {
  return {
    width: v.width,
    height: v.height,
    data: Uint8Array.from({ length: v.width * v.height * 4 }, (_, i) =>
      i % 4 === 3 ? (v.alpha ? (i * 7) % 256 : 255) : (i * 43 + Math.floor(i / 11)) % 256
    ),
    format: "raw",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: v.density,
    orientation: v.density === 72 ? 1 : 6,
    hasAlpha: v.alpha
  };
}
it.each(vectors)("preserves frozen WebP output %j", async (v) => {
  const image = raster(v),
    signal = new AbortController().signal;
  let reads = 0;
  const storage = {
    allocate() {
      throw new Error("unexpected allocation");
    },
    async write() {
      throw new Error("unexpected write");
    },
    async read(position: number, length: number, options?: { signal?: AbortSignal }) {
      expect(options?.signal).toBe(signal);
      expect(length).toBeLessThanOrEqual(4096);
      reads++;
      return image.data.subarray(position - 19, position - 19 + length);
    }
  };
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeWebpFromStorage({ ...image, position: 19 }, storage, signal)) {
    expect(chunk.length).toBeLessThanOrEqual(4096);
    chunks.push(chunk);
  }
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    result.set(c, at);
    at += c.length;
  }
  expect(reads).toBeGreaterThan(0);
  expect(result.length).toBe(v.length);
  expect(createHash("sha256").update(result).digest("hex")).toBe(v.hash);
  expect(readWebpMetadata(result)).toEqual(v.metadata);
  expect(encodeWebpImage(image)).toEqual(result);
});

it.each(["png", "ppm", "pgm", "pbm", "bmp", "tiff", "gif", "jpeg"] as const)(
  "streams WebP output from %s through caller storage",
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
      image.resize(19, 13).flip().rotate(17).webp({ quality: 83 });
    const expected = pipeline(sharp(bytes)).toBufferWithObjectSync(),
      info = await pipeline(sharp("/in", { filesystem: guarded })).toFile("/out");
    const actual = await fs.readFile("/out");
    expect(info).toEqual({ ...expected.info, size: actual.length });
    expect(Buffer.compare(actual, expected.data)).toBe(0);
    expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["in", "out"]);
  }
);

it("honors backpressure, chunk ownership, cancellation and caller cleanup ownership", async () => {
  const image = raster(vectors.at(-1)!),
    controller = new AbortController(),
    borrowed = new Uint8Array(4096);
  let reads = 0;
  const storage = {
    allocate() {
      throw new Error("allocate");
    },
    async write() {
      throw new Error("write");
    },
    async read(position: number, length: number) {
      reads++;
      borrowed.fill(0);
      borrowed.set(image.data.subarray(position, position + length));
      return borrowed.subarray(0, length);
    },
    async close() {
      throw new Error("caller owns cleanup");
    }
  };
  const stream = encodeWebpFromStorage({ ...image, position: 0 }, storage, controller.signal);
  expect(reads).toBe(0);
  const first = await stream.next(),
    copy = new Uint8Array(first.value!);
  expect(reads).toBe(1);
  await Promise.resolve();
  expect(reads).toBe(1);
  const second = await stream.next();
  expect(second.value!.length).toBeLessThanOrEqual(4096);
  expect(first.value).toEqual(copy);
  const reason = new Error("cancelled downstream");
  controller.abort(reason);
  await expect(stream.next()).rejects.toBe(reason);
  expect(reads).toBe(2);
});
for (const short of [false, true])
  it(`preserves ${short ? "short read" : "backing failure"} diagnostics`, async () => {
    const image = raster(vectors[0]!),
      reason = new Error("read failure");
    const stream = encodeWebpFromStorage(
      { ...image, position: 0 },
      {
        allocate() {
          throw 0;
        },
        async write() {
          throw 0;
        },
        async read() {
          if (short) return new Uint8Array();
          throw reason;
        }
      },
      new AbortController().signal
    );
    if (short) await expect(stream.next()).rejects.toThrow("Truncated image backing storage");
    else await expect(stream.next()).rejects.toBe(reason);
  });
