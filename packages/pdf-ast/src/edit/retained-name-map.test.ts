import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { replaceRetainedPdfNames } from "./retained-name-map.js";

it("replaces name tokens simultaneously across chunks without cascading", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const text = "/A /B /AB /A! (/A) %/B\n/A#20 /A-/A";
  async function* input() { const byte = new Uint8Array(1); for (const ch of text) { byte[0] = ch.charCodeAt(0); yield byte; } }
  const chunks = []; for await (const bytes of replaceRetainedPdfNames(input(), [["A", "B"], ["B", "C"]], { fs, directory: "/scratch" })) chunks.push(bytes);
  expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("/B /C /AB /B! (/B) %/C\n/B#20 /A-/B"); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["success", "cancel", "producer", "return"])("bounds pending long-name storage and releases it after %s", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("name-map failure"); let writes = 0, closed = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, prop) {
        if (prop === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => { expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536); writes++; await Promise.resolve(); return handle.write!(...args); };
        const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const name = "A".repeat(20000);
  async function* input() { try { yield Uint8Array.of(47); const chunk = new Uint8Array(1000).fill(65); for (let i = 0; i < 20; i++) yield chunk; if (mode === "producer") throw reason; if (mode === "cancel") controller.abort(reason); yield Uint8Array.of(33); } finally { closed = true; } }
  const output = replaceRetainedPdfNames(input(), [[name, "short"]], { fs: guarded, directory: "/scratch" }, { signal: controller.signal, chunkBytes: 1024 });
  if (mode === "cancel" || mode === "producer") await expect((async () => { for await (const ignored of output) void ignored; })()).rejects.toBe(reason);
  else { const chunks = []; for await (const bytes of output) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024); chunks.push(bytes); if (mode === "return") break; } if (mode === "success") expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("/short!"); }
  expect(closed).toBe(true); expect(writes).toBeGreaterThan(0); expect(await fs.readdir("/scratch")).toEqual([]);
});
