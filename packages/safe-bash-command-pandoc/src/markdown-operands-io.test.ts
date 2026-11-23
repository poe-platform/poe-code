import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convertToOutput, createLuaFilterCapability} from "./index.js";

it.each([false, true])("bounds retained Markdown operand page IO (fileScope=%s)", async fileScope => {
  const fs = new MemoryFileSystem();
  const open = fs.open.bind(fs);
  let reads = 0, writes = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const descriptor = await open(...args);
    const read = descriptor.read.bind(descriptor), write = descriptor.write.bind(descriptor);
    descriptor.read = async (...args) => {reads++; return read(...args);};
    descriptor.write = async (...args) => {writes++; return write(...args);};
    return descriptor;
  });
  const encoder = new TextEncoder();
  const filters = createLuaFilterCapability({readStream: () => [encoder.encode('function Str(el) return pandoc.Str(string.upper(el.text)) end')]});
  let text = "";
  await convertToOutput([97, 98].map(letter => ({chunks: (async function* () {
    for (let index = 0; index < 8; index++) yield new Uint8Array(1024).fill(letter);
  })()})), {from: "markdown", to: "plain", fileScope, filters: [{kind: "lua", path: "/filter.lua"}]}, {
    filters, workingFiles: {fs, directory: "/", cacheBytes: 131072},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}},
  });
  expect(text).toBe("A".repeat(8192) + "\n\n" + "B".repeat(8192) + "\n");
  expect(await fs.readdir("/")).toEqual([]);
  expect(reads).toBeGreaterThan(0);
  expect(reads).toBeLessThan(5000);
  expect(writes).toBeGreaterThan(0);
  expect(writes).toBeLessThan(600);
});
