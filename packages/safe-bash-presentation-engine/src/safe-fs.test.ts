import { expect, it, vi } from "vitest";
import { createMemoryFileSystem, FsError } from "@poe-code/safe-fs/core";
import { readBinary } from "./bytes.js";

it("reads PPTX inputs through the shared filesystem contract", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/deck", Uint8Array.of(1, 2, 3));
  expect(await readBinary({ path: "/deck", fs })).toEqual(Uint8Array.of(1, 2, 3));
});

it("passes byte admission and cancellation to buffered filesystems", async () => {
  const controller = new AbortController();
  const readFile = vi.fn(async () => Uint8Array.of(1, 2, 3));
  expect(
    await readBinary(
      { fs: { readFile }, path: "/deck" },
      { signal: controller.signal },
      { maxBytes: 3 }
    )
  ).toEqual(Uint8Array.of(1, 2, 3));
  expect(readFile).toHaveBeenCalledWith("/deck", { maxBytes: 3, signal: controller.signal });
  await expect(
    readBinary({ fs: { readFile }, path: "/deck" }, {}, { maxBytes: 2 })
  ).rejects.toMatchObject({ code: "resource-limit" });
});

it("falls back from unsupported streams only before any payload was emitted", async () => {
  const readFile = vi.fn(async () => Uint8Array.of(7));
  const source = (emitted: boolean) => ({
    readFile,
    async *readStream() {
      if (emitted) yield Uint8Array.of(1);
      throw new FsError("ENOTSUP");
    }
  });
  expect(await readBinary({ fs: source(false), path: "/deck" })).toEqual(Uint8Array.of(7));
  readFile.mockClear();
  await expect(readBinary({ fs: source(true), path: "/deck" })).rejects.toMatchObject({
    code: "io-failure"
  });
  expect(readFile).not.toHaveBeenCalled();
});

it("keeps missing files and filesystem byte limits typed without exposing paths", async () => {
  const fs = createMemoryFileSystem();
  await expect(readBinary({ fs, path: "/private/missing" })).rejects.toMatchObject({
    name: "PackageNotFoundError",
    code: "io-failure"
  });
  const readFile = async (): Promise<Uint8Array> => {
    throw new FsError("EFBIG");
  };
  await expect(readBinary({ fs: { readFile }, path: "/private/large" })).rejects.toMatchObject({
    code: "resource-limit"
  });
});

it("sanitizes iterator acquisition failures", async () => {
  const source = {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      throw new Error("private endpoint");
    }
  };
  await expect(readBinary(source)).rejects.toMatchObject({
    code: "io-failure",
    message: "Byte input failed."
  });
});

it("accepts shared asynchronous byte streams and snapshots reused chunks", async () => {
  const bytes = Uint8Array.of(1, 2);
  const source = (async function* () {
    yield bytes;
    bytes.fill(3);
    yield bytes;
  })();
  expect(await readBinary(source)).toEqual(Uint8Array.of(1, 2, 3, 3));
});
