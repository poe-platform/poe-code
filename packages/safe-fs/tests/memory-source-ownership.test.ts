import { expect, it } from "vitest";
import { MemoryFileSystem, getLastReadMemoryFileSourceRef, tryReadMemoryFileViewSync } from "../src/fs/memory/index.js";

it("source references own copied bytes across caller buffer reuse and filesystems", async () => {
  const source = new Uint8Array(1024 * 1024);
  const payload = source.subarray(100, 1100);
  payload.fill(65);
  const first = new MemoryFileSystem();
  await first.writeFile("/first", payload);
  const view = tryReadMemoryFileViewSync(first, "/first", undefined, undefined, true)!;
  const ref = getLastReadMemoryFileSourceRef(view)!;
  expect(ref.buffer).not.toBe(source.buffer);
  payload.fill(66);
  const second = new MemoryFileSystem();
  await second.writeFile("/second", payload);
  expect(ref[20]).toBe(65);
  expect((await first.readFile("/first"))[20]).toBe(65);
  expect((await second.readFile("/second"))[20]).toBe(66);
  expect(getLastReadMemoryFileSourceRef(view)).toBeUndefined();
});
