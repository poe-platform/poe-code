import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText} from "./backed-text.js";
import {BackedTextOrder} from "./backed-text-order.js";

it("sorts distinct long UTF-16 keys with stable identities across spills and later insertions", async () => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs); let transfers = 0, largest = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), read = handle.read.bind(handle), write = handle.write.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (bytes, ...rest) => {transfers++; largest = Math.max(largest, bytes.length); return read(bytes, ...rest);});
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...rest) => {transfers++; largest = Math.max(largest, bytes.length); return write(bytes, ...rest);});
    return handle;
  });
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const text = new BackedText(storage, async () => {}), order = new BackedTextOrder(storage, text);
  const values = ["", "\ud800", "😀", "\ue000", "prefix", "prefix-long", "a".repeat(12000) + "z", "a".repeat(12000) + "x",
    ...Array.from({length: 101}, (_, i) => "font-" + i)];
  const identities = new Map<string, number>();
  try {
    for (const value of [...values].reverse()) identities.set(value, await order.add(await text.from([value])));
    for (const value of values) {
      const key = await text.from((async function* () {for (let i = 0; i < value.length; i += 11) yield value.slice(i, i + 11);})());
      expect(await order.add(key)).toBe(identities.get(value));
      expect(await order.find(key)).toBe(identities.get(value));
    }
    expect(await order.find(await text.from(["absent"]))).toBe(0);
    const collect = async () => {
      const output: string[] = [];
      for await (const entry of order.entries()) {
        let key = ""; for await (const chunk of text.chunks(entry.value)) key += chunk;
        expect(entry.identity).toBe(identities.get(key)); output.push(key);
      }
      return output;
    };
    expect(await collect()).toEqual([...values].sort());
    identities.set("extra", await order.add(await text.from(["extra"])));
    expect(await collect()).toEqual([...values, "extra"].sort());
    expect(await collect()).toEqual([...values, "extra"].sort());
    expect(transfers).toBeGreaterThan(0); expect(largest).toBeLessThanOrEqual(16384);
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
