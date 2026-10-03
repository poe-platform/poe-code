import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";
const encoder = new TextEncoder();
const input = {bytes: encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{"nested":{"t":"MetaMap","c":{"keep":{"t":"MetaBool","c":true}}}},"blocks":[]}')};
it.each(["json", "html", "plain"])("retains typed metadata and merge order for %s", async to => {
  const options: ConversionOptions = {from: "json", to, metadataJson: [{nested: {extra: "json"}}], metadata: {
    nested: {t: "MetaMap", c: {last: {t: "MetaString", c: "typed"}}},
    title: {t: "MetaInlines", c: [{t: "Quoted", c: ["DoubleQuote", [{t: "Str", c: "title"}]]}]},
    long: {t: "MetaString", c: "😀".repeat(20000)}
  }};
  const expected = await convert([input], options, {});
  const fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
    }});
    expect(expected).toMatchObject({text}); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
it.each([
  {x: {t: "MetaString", c: 1}}, {x: {t: "Bogus"}}, {x: {t: "MetaList", c: [null]}},
  {x: {t: "MetaInlines", c: [{t: "Math", c: ["Wrong", "x"]}]}},
  {x: {t: "MetaString", c: "\ud800"}}, {x: {t: "MetaString", c: Infinity}},
  {x: {t: "MetaBlocks", c: [{t: "Header", c: [0, ["", [], []], []]}]}}
])("preserves typed metadata diagnostics before acquiring input: %j", async value => {
  const options = {from: "json", to: "json", metadata: value} as ConversionOptions;
  const expected = await convert([input], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(), acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Input forbidden"));
  try {
    await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write() {throw new Error("Output forbidden");}, async close() {}, async abort() {}
    }})).rejects.toMatchObject({code: expected.code, message: expected.message, operation: expected.operation, location: expected.location});
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
it("converts every typed enum position without converting metadata text", async () => {
  const attr = ["", [], []];
  const blocks = [
    {t: "Para", c: [{t: "Math", c: ["InlineMath", "x"]}, {t: "Cite", c: [[{citationId: "a", citationPrefix: [], citationSuffix: [], citationMode: "AuthorInText", citationNoteNum: 0, citationHash: 0}], []]}]},
    {t: "OrderedList", c: [[1, "Decimal", "Period"], [[]]]},
    {t: "Table", c: [attr, [null, []], [["AlignLeft", {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], [[attr, [[attr, "AlignCenter", 1, 1, []]]]]]], [attr, []]]}
  ];
  const options = {from: "json", to: "json", metadata: {x: {t: "MetaBlocks", c: blocks}, t: {t: "MetaString", c: "Math"}}} as ConversionOptions;
  const expected = await convert([input], options, {});
  const fs = new MemoryFileSystem(); let text = "";
  await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  expect(expected).toMatchObject({text}); expect(await fs.readdir("/")).toEqual([]);
});
it.each(["getter", "cycle", "sparse", "symbol", "prototype", "hidden"])("rejects invalid SDK graphs before input: %s", async mode => {
  const value: Record<string, unknown> = {t: "MetaList", c: []};
  const getter = vi.fn(() => "side effect");
  if (mode === "getter") Object.defineProperty(value, "c", {get: getter, enumerable: true});
  if (mode === "cycle") value.c = [value];
  if (mode === "sparse") value.c = Array(1);
  if (mode === "symbol") Object.defineProperty(value, Symbol("x"), {value: true});
  if (mode === "prototype") Object.setPrototypeOf(value, {x: true});
  if (mode === "hidden") Object.defineProperty(value, "hidden", {value: true});
  const options = {from: "json", to: "json", metadata: {x: value}} as unknown as ConversionOptions;
  const fs = new MemoryFileSystem(), acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Input forbidden"));
  try {
    await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: "E_AST", operation: "convert"});
    expect(acquire).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["success", "cancel", "storage-error", "sink-error"])("bounds typed metadata transfers and retires stores: %s", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let live = 0, peak = 0, writes = 0, pending = 0;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle);
    peak = Math.max(peak, ++live);
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      expect(args[0].length).toBeLessThanOrEqual(16384);
      if (++writes === 5) {if (mode === "storage-error") throw new Error("Storage failed"); if (mode === "cancel") controller.abort();}
      return write(...args);
    });
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {try {return await close(...args);} finally {live--;}});
    return handle;
  });
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const operation = convertToOutput([input], {from: "json", to: "json", metadata: {x: {t: "MetaString", c: "x".repeat(131072)}}}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, signal: controller.signal,
    output: {async write(bytes) {expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); if (mode === "sink-error") throw new Error("Sink failed"); await Promise.resolve(); pending--;}, close, abort}
  });
  if (mode === "success") {await operation; expect(close).toHaveBeenCalledOnce();}
  else {await expect(operation).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(live).toBe(0); expect(peak).toBeLessThanOrEqual(10); expect(writes).toBeGreaterThan(0); expect(await fs.readdir("/")).toEqual([]);
  expect(abort).toHaveBeenCalledTimes(mode === "sink-error" ? 1 : 0);
});
it("retains deeply nested typed maps and snapshots shared values independently", async () => {
  const leaf = {t: "MetaString", c: "leaf"} as const;
  let value: unknown = leaf;
  for (let i = 0; i < 64; i++) value = {t: "MetaMap", c: {x: value}};
  const metadata = {deep: value, a: leaf, b: leaf} as NonNullable<ConversionOptions["metadata"]>;
  const fs = new MemoryFileSystem(); let text = "";
  await convertToOutput([input], {from: "json", to: "json", metadata}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  const result = JSON.parse(text); let node = result.meta.deep;
  for (let i = 0; i < 64; i++) node = node.c.x;
  expect(node).toEqual(leaf); expect(result.meta.a).toEqual(result.meta.b); expect(await fs.readdir("/")).toEqual([]);
});
it("does not charge typed option values as document input bytes", async () => {
  const fs = new MemoryFileSystem();
  await convertToOutput([input], {from: "json", to: "json", metadata: {large: {t: "MetaString", c: "x".repeat(32768)}}}, {
    limits: {inputBytes: input.bytes.length}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}
  });
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["admission", "publication"])("does not commit output when typed storage retirement fails during %s", async phase => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs); let emitted = false, failed = false, live = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle); live++;
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {
      try {await close(...args);} finally {live--;}
      if (emitted === (phase === "publication") && !failed) {failed = true; throw new Error("Retirement failed");}
    }); return handle;
  });
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  await expect(convertToOutput([input], {from: "json", to: "json", metadata: {x: {t: "MetaString", c: "x".repeat(32768)}}}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {emitted = true;}, close, abort}
  })).rejects.toMatchObject({code: "E_IO", message: "Capability failed"});
  expect(failed).toBe(true); expect(close).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledTimes(phase === "publication" ? 1 : 0); expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});
