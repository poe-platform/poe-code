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
      await set.add(first);
      const second = await text.from((async function* () {for (let i = 0; i < value.length; i += 17) yield value.slice(i, i + 17);})());
      expect(await set.has(second)).toBe(true);
    }
    expect(await set.has(await text.from(["costarring"]))).toBe(true);
    expect(await set.has(await text.from(["liquid"]))).toBe(true);
    expect(await set.has(await text.from(["missing"]))).toBe(false);
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
