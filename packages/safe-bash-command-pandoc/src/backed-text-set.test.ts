import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";

it("indexes long text and resolves colliding hashes without collecting keys", async () => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const text = new BackedText(storage, async () => {}), set = new BackedTextSet(storage, text);
  try {
    for (const value of ["costarring", "liquid", "a".repeat(20000), "a".repeat(19999) + "b", "", "\ud800"]) {
      const first = await text.from([value]);
      expect(await set.has(first)).toBe(false);
      const identity = await set.add(first);
      expect(identity).toBeGreaterThan(0);
      const second = await text.from((async function* () {for (let i = 0; i < value.length; i += 17) yield value.slice(i, i + 17);})());
      expect(await set.has(second)).toBe(true);
      expect(await set.add(second)).toBe(identity);
    }
    expect(await set.has(await text.from(["costarring"]))).toBe(true);
    expect(await set.has(await text.from(["liquid"]))).toBe(true);
    expect(await set.has(await text.from(["missing"]))).toBe(false);
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});


it("interns replayable keys without duplicate storage, including equal-length hash collisions", async () => {
  const fs = new MemoryFileSystem(), storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const text = new BackedText(storage, async () => {}), set = new BackedTextSet(storage, text);
  let started = 0, closed = 0;
  const source = (value: string, size: number) => async function* () {
    started++;
    try {yield ""; for (let offset = 0; offset < value.length; offset += size) yield value.slice(offset, offset + size); yield "";}
    finally {closed++;}
  };
  try {
    // These distinct eight-unit keys both have FNV-1a hash 3586579209.
    const left = await set.intern(source("6Y9t8bYY", 3)), right = await set.intern(source("a6ocHS7q", 5));
    expect(left).not.toBe(right);
    for (const value of ["6Y9t8bYY", "a6ocHS7q", "", "a😀".repeat(16385) + "\ud800"]) {
      const identity = await set.intern(source(value, 17)), extent = storage.allocate(0);
      for (const size of [1, 4096]) {
        expect(await set.intern(source(value, size))).toBe(identity);
        expect(storage.allocate(0)).toBe(extent);
      }
      expect(await set.add(await text.from([value]))).toBe(identity);
      expect(started).toBe(closed);
    }
    const extent = storage.allocate(0);
    await expect(set.intern(async function* () {yield "not complete"; throw new Error("Source failed");})).rejects.toThrow("Source failed");
    expect(storage.allocate(0)).toBe(extent);
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
