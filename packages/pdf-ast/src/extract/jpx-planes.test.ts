import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfFileSource } from "../source.js";
import { PdfRetainedJpx } from "./retained-jpx.js";
import { decodeJpxToRgba } from "./images.js";

it.each(
  ["rgb-lossless.j2k", "rgb-lossless.jp2", "rgb-tiled.jp2", "gray-lossless.jp2"].flatMap((name) =>
    [0, -7, 7, 17].map((delta) => ({ name, delta }))
  )
)(
  "backs JPEG 2000 planes with caller storage: $name, quantization delta $delta",
  async ({ name, delta }) => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/" + name, import.meta.url))),
      fs = createMemoryFileSystem();
    if (delta)
      for (let i = 0; i < bytes.length - 4; i++)
        if (bytes[i] === 255 && bytes[i + 1] === 92) {
          const mode = bytes[i + 4]! & 31,
            end = i + 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
          for (let j = i + 5; j < end; j += mode === 0 ? 1 : 2)
            bytes[j] = (Math.max(0, Math.min(31, (bytes[j]! >> 3) + delta)) << 3) | (bytes[j]! & 7);
          break;
        }
    await fs.mkdir("/scratch");
    await fs.writeFile("/input", bytes);
    const source = await PdfFileSource.open(fs, "/input"),
      backing = new PagedStorage(
        { fs, cwd: "/scratch", env: {}, signal: new AbortController().signal },
        2
      );
    let allocated = 0;
    try {
      const image = await PdfRetainedJpx.open(source, {
        coefficientStorage: {
          allocate(length) {
            allocated += length;
            return backing.allocate(length);
          },
          read: backing.read.bind(backing),
          write: backing.write.bind(backing)
        }
      });
      try {
        const result = [];
        for await (const row of image.rows()) result.push(...row);
        expect(result).toEqual([...decodeJpxToRgba(bytes)]);
        expect(allocated).toBeGreaterThan(0);
      } finally {
        image.close();
      }
    } finally {
      await backing.close();
      await source.close();
      expect(await fs.readdir("/scratch")).toEqual([]);
    }
  }
);

it("preserves plane backing failures and cancellation without taking ownership", async () => {
  const bytes = new Uint8Array(readFileSync(new URL("../fixtures/rgb-tiled.jp2", import.meta.url))),
    fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes);
  const source = await PdfFileSource.open(fs, "/input"),
    failure = { reason: "plane backend failed" };
  try {
    await expect(
      PdfRetainedJpx.open(source, {
        coefficientStorage: {
          allocate() {
            throw failure;
          },
          async read() {
            throw failure;
          },
          async write() {
            throw failure;
          }
        }
      })
    ).rejects.toBe(failure);
    await expect(
      PdfRetainedJpx.open(source, {
        coefficientStorage: {
          allocate() {
            return 0;
          },
          async read() {
            throw failure;
          },
          async write() {
            throw failure;
          }
        }
      })
    ).rejects.toBe(failure);
    const controller = new AbortController();
    await expect(
      PdfRetainedJpx.open(source, {
        signal: controller.signal,
        coefficientStorage: {
          allocate() {
            return 0;
          },
          async read() {
            return new Uint8Array();
          },
          async write() {
            controller.abort(failure);
          }
        }
      })
    ).rejects.toBe(failure);
  } finally {
    await source.close();
  }
});
it("cancels a suspended caller-backed row when closed", async () => {
  const bytes = new Uint8Array(
      readFileSync(new URL("../fixtures/gray-lossless.jp2", import.meta.url))
    ),
    fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/input", bytes);
  const source = await PdfFileSource.open(fs, "/input"),
    backing = new PagedStorage(
      { fs, cwd: "/scratch", env: {}, signal: new AbortController().signal },
      2
    );
  let release: (() => void) | undefined,
    entered: (() => void) | undefined,
    suspend = false;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    const image = await PdfRetainedJpx.open(source, {
      coefficientStorage: {
        allocate: backing.allocate.bind(backing),
        write: backing.write.bind(backing),
        async read(at, length, options) {
          if (suspend) {
            entered!();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          options?.signal?.throwIfAborted();
          return backing.read(at, length);
        }
      }
    });
    suspend = true;
    const row = image.rows().next();
    await waiting;
    image.close();
    release!();
    await expect(row).rejects.toThrow("closed");
  } finally {
    await backing.close();
    await source.close();
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
});
