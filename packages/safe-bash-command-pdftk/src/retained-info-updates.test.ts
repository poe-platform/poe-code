import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { retainedInfoUpdates } from "./retained-info-updates.js";

it("spills a bookmark line before its producer reaches the delimiter", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let writes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => { writes++; return handle.write!(...args); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  async function* chunks() {
    yield new TextEncoder().encode("BookmarkBegin\nBookmarkTitle: ");
    const bytes = new Uint8Array(4096).fill(65);
    for (let i = 0; i < 128; i++) { if (i === 96) expect(writes).toBeGreaterThan(0); yield bytes; }
    yield new TextEncoder().encode(" &#x1F600;\nBookmarkLevel: 1\nBookmarkPageNumber: 1\n");
  }
  let found = 0;
  for await (const update of retainedInfoUpdates(chunks(), new AbortController().signal, { fs: guarded, directory: "/scratch" })) {
    if (update.kind !== "bookmark") continue;
    expect(typeof update.title).toBe("function"); if (typeof update.title !== "function") throw new Error("title was collected");
    let length = 0, tail = "";
    for await (const part of update.title()) { expect(part.length).toBeLessThanOrEqual(4096); length += part.length; tail = (tail + part).slice(-3); }
    expect(length).toBe(524291); expect(tail).toBe(" 😀"); found++;
  }
  expect(found).toBe(1); expect(await fs.readdir("/scratch")).toEqual([]);
});
