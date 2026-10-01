import { expect, it } from "vitest";
import { MemoryFileSystem, getLastReadMemoryFileSourceRef, tryReadMemoryFileViewSync } from "../src/fs/memory/index.js";

it("admits memory reads before accessing the file and skips declined probes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/file', new Uint8Array([42]));
  let charges = 0;
  const admit = () => { charges++; };
  expect(tryReadMemoryFileViewSync(fs, '/file', undefined, undefined, false, admit)).toEqual(new Uint8Array([42]));
  expect(charges).toBe(1);
  const denied = new Error('read budget exhausted');
  expect(() => tryReadMemoryFileViewSync(fs, '/missing', undefined, undefined, false, () => { throw denied; })).toThrow(denied);
  expect(() => tryReadMemoryFileViewSync(fs, '/missing', undefined, undefined, false, admit)).toThrow();
  expect(charges).toBe(2);
  fs.readFile = fs.readFile.bind(fs);
  expect(tryReadMemoryFileViewSync(fs, '/file', undefined, undefined, false, admit)).toBeUndefined();
  expect(charges).toBe(2);
});

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

it("updates access time on every fast read, including cached clock ticks", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(65));
  for (let i = 0; i < 65; i++) {
    await fs.utimes("/file", 0, 0);
    tryReadMemoryFileViewSync(fs, "/file");
    expect((await fs.stat("/file")).atimeMs).toBeGreaterThan(0);
  }
});

it("does not expose an unconsumed source capture after another read", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(65));
  const view = tryReadMemoryFileViewSync(fs, "/file", undefined, undefined, true)!;
  tryReadMemoryFileViewSync(fs, "/file");
  expect(getLastReadMemoryFileSourceRef(view)).toBeUndefined();
});

it.each(["replace", "append", "grow"])("releases obsolete source storage on %s", async (mutation) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(600).fill(65));
  // Inspect the node to verify obsolete allocations are no longer retained by metadata.
  const node = (fs as unknown as { file(path: string, syscall: string): { sourceRef?: Uint8Array } }).file("/file", "readFile");
  expect(node.sourceRef).toBeDefined();
  if (mutation === "replace") await fs.writeFile("/file", Uint8Array.of(66));
  else await fs.appendFile("/file", new Uint8Array(mutation === "grow" ? 70000 : 1).fill(66));
  expect(node.sourceRef).toBeUndefined();
  const view = tryReadMemoryFileViewSync(fs, "/file", undefined, undefined, true)!;
  expect(getLastReadMemoryFileSourceRef(view)).toBeUndefined();
});
