import { expect, test, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { createReplayFile } from "./storage.js";

test("replay storage uses retained caller files, bounded writes and reads, and cleans up", async () => {
  const fs = new MemoryFileSystem();
  const wholeRead = vi.fn(() => { throw new Error("whole read"); });
  const original = fs.createStagedFile.bind(fs);
  let largestWrite = 0;
  const create: typeof fs.createStagedFile = async (...args) => {
    const result = await original(...args);
    return { ...result, writer: {
      write: async (bytes, options) => { largestWrite = Math.max(largestWrite, bytes.length); await result.writer!.write(bytes, options); },
      finish: options => result.writer!.finish(options)
    } };
  };
  const adapter = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return wholeRead;
    if (key === "createStagedFile") return create;
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const file = await createReplayFile(adapter, "/", new AbortController().signal);
  const chunk = new Uint8Array(70000).fill(42);
  await file.write(chunk);
  chunk.fill(0);
  await file.seal();
  expect(largestWrite).toBeLessThanOrEqual(16384);
  let length = 0;
  for await (const bytes of file.read()) { expect(bytes.length).toBeLessThanOrEqual(16384); expect(bytes.every(x => x === 42)).toBe(true); length += bytes.length; }
  expect(length).toBe(70000);
  expect(wholeRead).not.toHaveBeenCalled();
  await file.close();
  await file.close();
  expect(await fs.readdir("/")).toEqual([]);
});

test("replay cancellation retains cleanup authority", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const file = await createReplayFile(fs, "/", controller.signal);
  await file.write(new Uint8Array([1]));
  controller.abort(new Error("cancelled"));
  await expect(file.seal()).rejects.toThrow("cancelled");
  await file.close();
  expect(await fs.readdir("/")).toEqual([]);
});

test("spill write failure keeps its identity and releases owned storage", async () => {
  const fs = new MemoryFileSystem();
  const failure = new Error("external write failed");
  const adapter = new Proxy(fs, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const result = await target.createStagedFile(...args);
      return { ...result, writer: { ...result.writer!, write: async () => { throw failure; } } };
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const file = await createReplayFile(adapter, "/", new AbortController().signal);
  await expect(file.write(new Uint8Array(70000))).rejects.toBe(failure);
  await file.close();
  expect(await fs.readdir("/")).toEqual([]);
});

test("retained replay refuses content mutation and does not delete a replacement", async () => {
  const fs = new MemoryFileSystem();
  const file = await createReplayFile(fs, "/", new AbortController().signal);
  await file.write(new Uint8Array(70000));
  await file.seal();
  const directory = (await fs.readdir("/"))[0]!.name;
  await fs.writeFile(`/${directory}/rows`, new Uint8Array([1, 2, 3]));
  await expect(file.read()[Symbol.asyncIterator]().next()).rejects.toThrow("replay storage changed");
  await expect(file.close()).rejects.toThrow();
  expect(await fs.readFile(`/${directory}/rows`)).toEqual(new Uint8Array([1, 2, 3]));
});
