import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine } from "./engine.js";
import type { WorkingStorage } from "./contracts.js";

it("spills isolated codec stores through one bounded caller cache and revokes them at session end", async () => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let written = 0, maximum = 0, closed = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, position, options) => {
      written += bytes.length; maximum = Math.max(maximum, bytes.length); return write(bytes, position, options);
    });
    vi.spyOn(handle, "close").mockImplementation(async options => { closed++; await close(options); });
    return handle;
  });
  let saved!: WorkingStorage;
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 32768 }, codecs: [{
    id: "store", description: "fixture", extensions: [], async read(_bytes, context) {
      const first = saved = context.createWorkingStorage!(), second = context.createWorkingStorage!();
      const size = 160 * 16384, start = first.allocate(size);
      expect(second.allocate(size)).toBe(start);
      const reused = new Uint8Array(16384);
      for (let i = 0; i < 160; i++) {
        reused.fill(i); await first.write(start + i * reused.length, reused);
        reused.fill(255 - i); await second.write(start + i * reused.length, reused);
      }
      reused.fill(0);
      for (const i of [0, 159, 128, 17]) {
        expect(await first.read(start + i * reused.length, reused.length)).toEqual(new Uint8Array(16384).fill(i));
        expect(await second.read(start + i * reused.length, reused.length)).toEqual(new Uint8Array(16384).fill(255 - i));
      }
      await second.close();
      await expect(second.read(start, 1)).rejects.toThrow("closed");
      expect(() => second.allocate(1)).toThrow("closed");
      await expect(first.read(start, 16385)).rejects.toThrow();
      await expect(first.write(start, new Uint8Array(16385))).rejects.toThrow();
      await expect(first.read(start - 1, 1)).rejects.toThrow();
      await expect(first.read(start + size, 1)).rejects.toThrow();
      return { sheets: [] };
    }
  }] });
  await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "store" }, { signal: new AbortController().signal });
  await expect(saved.read(8, 1)).rejects.toThrow();
  expect(written).toBeGreaterThan(32768); expect(maximum).toBeLessThanOrEqual(16384);
  expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});

it.each(["write", "cancel"])("cleans up codec storage after %s failure", async mode => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  const failure = new Error("spill failed"); let closed = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async () => {
      if (mode === "cancel") controller.abort(failure);
      throw failure;
    });
    vi.spyOn(handle, "close").mockImplementation(async options => { closed++; await close(options); });
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{
    id: "store", description: "fixture", extensions: [], async read(_bytes, context) {
      const store = context.createWorkingStorage!(), start = store.allocate(65536);
      for (let offset = 0; offset < 65536; offset += 16384) await store.write(start + offset, new Uint8Array(16384));
      return { sheets: [] };
    }
  }] });
  await expect(engine.readWorkbook({ kind: "stream", source: [] }, { importType: "store" }, { signal: controller.signal })).rejects.toBe(failure);
  expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});
