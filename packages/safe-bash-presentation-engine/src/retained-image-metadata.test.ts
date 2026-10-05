import { expect, it } from "vitest";
import { sha1 } from "@noble/hashes/legacy.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { imageMetadata } from "./image-metadata.js";
import { readRetainedImageMetadata } from "./retained-image-metadata.js";

function png(size: number) {
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 300);
  view.setUint32(20, 150);
  view.setUint32(33, size - 78);
  bytes.set([73, 68, 65, 84], 37);
  const end = size - 33;
  view.setUint32(end, 9);
  bytes.set([112, 72, 89, 115], end + 4);
  view.setUint32(end + 8, 3780);
  view.setUint32(end + 12, 1890);
  bytes[end + 16] = 1;
  bytes.set([73, 69, 78, 68], size - 8);
  return bytes;
}
function tiff(size: number) {
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  bytes.set([73, 73, 42, 0, 8, 0, 0, 0]);
  view.setUint16(8, 4, true);
  for (const [i, tag, type, value] of [
    [0, 256, 4, 300],
    [1, 282, 5, size - 16],
    [2, 257, 4, 150],
    [3, 283, 5, size - 8]
  ]) {
    const p = 10 + i! * 12;
    view.setUint16(p, tag!, true);
    view.setUint16(p + 2, type!, true);
    view.setUint32(p + 4, 1, true);
    view.setUint32(p + 8, value!, true);
  }
  view.setUint32(size - 16, 96, true);
  view.setUint32(size - 12, 1, true);
  view.setUint32(size - 8, 48, true);
  view.setUint32(size - 4, 1, true);
  return bytes;
}
function jpeg() {
  // Maximum APP1 segment, with a TIFF rational near its end followed by
  // a return to the early directory entries and then a new frame segment.
  const bytes = new Uint8Array(65556);
  bytes.set([255, 216, 255, 225, 255, 255, 69, 120, 105, 102, 0, 0]);
  bytes.set(tiff(65527), 12);
  bytes.set([255, 192, 0, 11, 8, 0, 25, 0, 50, 1, 1, 17, 0, 255, 218], 65539);
  return bytes;
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
for (const [type, bytes] of [
  ["image/png", png(300000)],
  ["image/jpeg", jpeg()],
  ["image/tiff", tiff(300000)],
  ["image/gif", new Uint8Array([71, 73, 70, 56, 57, 97, 40, 0, 30, 0, 0, 0, 0])],
  ["image/svg+xml", new Uint8Array(300000)]
] as const)
  it(`hashes and reads ${type} from one reused sequential source`, async () => {
    const fs = createMemoryFileSystem();
    let opens = 0,
      finished = false,
      writes = 0;
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file IO forbidden");
          };
        const value = Reflect.get(target, key);
        if (type !== "image/tiff" && typeof value === "function")
          return () => {
            throw new Error("sequential formats must not spool");
          };
        if (key === "open")
          return (...args: unknown[]) => {
            writes++;
            return value.apply(target, args);
          };
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const result = await readRetainedImageMetadata(
      {
        async byteLength() {
          return bytes.length;
        },
        async *read() {
          opens++;
          const reused = new Uint8Array(4093);
          try {
            for (let p = 0; p < bytes.length; p += reused.length) {
              const n = Math.min(reused.length, bytes.length - p);
              reused.set(bytes.subarray(p, p + n));
              yield reused.subarray(0, n);
              reused.fill(255);
              await Promise.resolve();
            }
          } finally {
            finished = true;
          }
        }
      },
      "/image",
      type,
      { workingStorage: { fs: guarded, directory: "/", cacheBytes: 16384 } }
    );
    expect(result).toEqual({ ...imageMetadata(bytes, type), sha1: hex(sha1(bytes)) });
    expect(opens).toBe(1);
    expect(finished).toBe(true);
    if (type === "image/tiff") expect(writes).toBeGreaterThan(0);
    expect(await fs.readdir("/")).toEqual([]);
  });
for (const type of ["image/png", "image/tiff"])
  for (const mode of ["short", "long", "source", "cancel"])
    it(`retires ${type} streams and scratch on ${mode}`, async () => {
      const fs = createMemoryFileSystem(),
        controller = new AbortController();
      let retired = false;
      const promise = readRetainedImageMetadata(
        {
          async byteLength() {
            return 200000;
          },
          async *read() {
            try {
              yield new Uint8Array(16384);
              if (mode === "source") throw new Error("read failed");
              if (mode === "cancel") controller.abort();
              if (mode === "long") yield new Uint8Array(200000);
            } finally {
              retired = true;
            }
          }
        },
        "/image",
        type,
        { signal: controller.signal, workingStorage: { fs, directory: "/", cacheBytes: 16384 } }
      );
      await expect(promise).rejects.toMatchObject({
        code: mode === "cancel" ? "cancelled" : mode === "source" ? "io-failure" : "invalid-archive"
      });
      expect(retired).toBe(true);
      expect(await fs.readdir("/")).toEqual([]);
    });

for (const size of [1024 * 1024, 4 * 1024 * 1024])
  it(`streams a generated ${size}-byte PNG without any payload spool`, async () => {
    const template = png(100),
      header = template.slice(0, 41),
      tail = template.slice(67);
    new DataView(header.buffer).setUint32(33, size - 78);
    const expected = sha1.create();
    let yielded = 0,
      live = 0;
    const fs = createMemoryFileSystem(),
      forbidden = new Proxy(fs, {
        get() {
          throw new Error("unexpected spool");
        }
      });
    const result = await readRetainedImageMetadata(
      {
        async byteLength() {
          return size;
        },
        async *read() {
          const reuse = new Uint8Array(16384);
          for (let offset = 0; offset < size; offset += reuse.length) {
            expect(live).toBe(0);
            live++;
            const n = Math.min(reuse.length, size - offset);
            reuse.fill(0);
            for (const [at, bytes] of [
              [0, header],
              [size - tail.length, tail]
            ] as const) {
              const a = Math.max(offset, at),
                b = Math.min(offset + n, at + bytes.length);
              if (a < b) reuse.set(bytes.subarray(a - at, b - at), a - offset);
            }
            expected.update(reuse.subarray(0, n));
            yielded += n;
            yield reuse.subarray(0, n);
            live--;
            reuse.fill(255);
          }
        }
      },
      "/image",
      "image/png",
      { workingStorage: { fs: forbidden, directory: "/", cacheBytes: 16384 } }
    );
    expect(result).toEqual({
      pixelWidth: 300,
      pixelHeight: 150,
      dpiX: 96,
      dpiY: 48,
      sha1: hex(expected.digest())
    });
    expect(yielded).toBe(size);
    expect(live).toBe(0);
  });

for (const mode of ["slow", "write", "read", "close"] as const)
  it(`bounds TIFF backing IO and retires the handle on ${mode}`, async () => {
    const fs = createMemoryFileSystem(),
      bytes = tiff(300000);
    let outstanding = 0,
      maximum = 0,
      closed = 0,
      written = 0;
    const wrapped = new Proxy(fs, {
      get(target, key) {
        if (key === "open")
          return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
            const descriptor = await target.open!(...args);
            return new Proxy(descriptor, {
              get(handle, method) {
                const value = Reflect.get(handle, method);
                if (method === "read" || method === "write")
                  return async (...args: unknown[]) => {
                    const buffer = args[0] as Uint8Array;
                    expect(buffer.length).toBeLessThanOrEqual(16384);
                    maximum = Math.max(maximum, ++outstanding);
                    try {
                      await Promise.resolve();
                      if (method === mode) throw new Error("injected backing failure");
                      if (method === "write") written += buffer.length;
                      return await value.apply(handle, args);
                    } finally {
                      outstanding--;
                    }
                  };
                if (method === "close")
                  return async () => {
                    closed++;
                    await handle.close();
                    if (mode === "close") throw new Error("close failed");
                  };
                return typeof value === "function" ? value.bind(handle) : value;
              }
            });
          };
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file IO forbidden");
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const promise = readRetainedImageMetadata(
      {
        async byteLength() {
          return bytes.length;
        },
        async *read() {
          for (let p = 0; p < bytes.length; p += 4096) yield bytes.subarray(p, p + 4096);
        }
      },
      "/image",
      "image/tiff",
      { workingStorage: { fs: wrapped, directory: "/", cacheBytes: 16384 } }
    );
    if (mode === "slow") {
      expect(await promise).toEqual({
        ...imageMetadata(bytes, "image/tiff"),
        sha1: hex(sha1(bytes))
      });
      expect(written).toBeGreaterThan(bytes.length - 16384);
    } else await expect(promise).rejects.toMatchObject({ code: "io-failure" });
    expect(maximum).toBe(1);
    expect(outstanding).toBe(0);
    expect(closed).toBe(1);
    expect(await fs.readdir("/")).toEqual([]);
  });
