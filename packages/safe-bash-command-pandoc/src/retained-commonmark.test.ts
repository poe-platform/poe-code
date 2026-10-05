import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";

const samples = [
  "---\ntitle: kept\nloop: &loop [*loop]\n---\nbody",
  "", "plain", "# Title\n\nText with *emphasis*, **bold**, [link](target 'title') and ![image](image.png).",
  "> - outer\n>   - inner\n>\n>   paragraph\n", "1. one\n2. two\n\n   three\n",
  "- [x] done\n- [ ] todo\n  - [X] nested\n", "a|b\n:--|--:\nx|*y*\nz\n",
  "```js extra\nx\n```\n\n    code\n\n    more\n", "<script>\nbody\n</script>\n\n<div>safe</div>",
  "[ref]\n\n[ref]: /target 'title'\n", "[@a] **[-@b]**\n\n> [@c]", "a".repeat(65537),
  "---\ntitle: Title\nflag: true\nnumber: 123\nlist: [a, null, 2]\nmap:\n  key: value\n---\n\nBody",
  "---\nreferences: []\n---\n[@a]", "---\nx: &x {key: 1}\ny: *x\n...\nbody",
  "---\nbad: [\n---\nbody", "---\nduplicate: 1\nduplicate: 2\n---\nbody", "---\nkey: value\n---\n",
  "---\nkey: value\n\n---\nbody", "---\n  indented: value\n---\nbody", "---\nkey: value\n...\n  \nbody",
  "\ufeffa\r\nb\rc\n\n\t d", "---\n__proto__: {bad: value}\n---\nbody",
];
it.each(samples.map((text, index) => ({text, index})))("streams public Markdown source and body $index", async ({text}) => {
  for (const fileScope of [false, true]) {
    const input = {bytes: new TextEncoder().encode(text), source: "document.md", base: "/docs"};
    const options = {from: "gfm+citations", to: "json", fileScope}, expected = await convert([input], options, {}).catch(error => error);
    const fs = new MemoryFileSystem(); let actual = "";
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden"));
    try {
      const result = await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(bytes) {actual += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(result).toMatchObject({message: expected.message, code: (expected as {code?: string}).code, location: (expected as {location?: string}).location});
      else {expect(result).not.toBeInstanceOf(Error); expect(actual).toBe(expected.kind === "text" ? expected.text : undefined);}
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
it("uses real streamed Lua for growing Markdown with noncollecting output", async () => {
  for (const length of [4096, 16384, 65536]) {
    const fs = new MemoryFileSystem(), open = vi.spyOn(fs, "open");
    const filters = createLuaFilterCapability({readStream: async function* () {yield new TextEncoder().encode("function Str(el) return pandoc.Str(string.upper(el.text)) end");}});
    const resident = vi.spyOn(filters, "apply"), streamed = vi.spyOn(filters, "applyJsonStream"); let count = 0;
    await convertToOutput([{chunks: (async function* () {for (let i = 0; i < length; i += 1024) yield new TextEncoder().encode("a".repeat(Math.min(1024, length - i)));})()}],
      {from: "markdown", to: "plain", filters: [{kind: "lua", path: "/upper.lua"}]},
      {filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(bytes) {for (const byte of bytes) expect(byte === 65 || byte === 10).toBe(true); count += bytes.length;}, async close() {}, async abort() {}
      }});
    expect(resident).not.toHaveBeenCalled(); expect(streamed).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalled();
    expect(count).toBe(length + 1); expect(await fs.readdir("/")).toEqual([]);
  }
});
it.each(["json", "plain", "html5", "rst", "commonmark", "gfm", "latex", "rtf", "odt"])("preserves public Markdown output to %s", async to => {
  const input = {bytes: new TextEncoder().encode("---\ntitle: Title\n---\n# Heading\n\n*body* and [link](https://example.test)\n\n- item\n")};
  const options = {from: "markdown", to, lossy: true}, expectedBytes: number[] = [], actualBytes: number[] = [];
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  const expected = await convert([input], options, {output: sink(expectedBytes)}), fs = new MemoryFileSystem();
  const actual = await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: sink(actualBytes)});
  expect(actualBytes).toEqual(expectedBytes); expect(actual.diagnostics).toEqual(expected.diagnostics); expect(await fs.readdir("/")).toEqual([]);
});
it.each(["source", "cancel", "sink", "scratch"])("cleans Markdown storage after %s failure", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let returned = false, writes = 0;
  if (mode === "scratch") vi.spyOn(fs, "open").mockRejectedValue(new Error("Scratch failed"));
  const input = {chunks: (async function* () {try {yield new TextEncoder().encode("body".repeat(5000)); if (mode === "source") throw new Error("Source failed"); if (mode === "cancel") controller.abort();} finally {returned = true;}})()};
  const close = vi.fn(), abort = vi.fn();
  await expect(convertToOutput([input], {from: "markdown", to: "plain"}, {signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {writes++; if (mode === "sink") throw new Error("Sink failed");}, close, abort}})).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(returned).toBe(true); expect(writes).toBe(mode === "sink" ? 1 : 0); expect(close).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledTimes(mode === "sink" ? 1 : 0); expect(await fs.readdir("/")).toEqual([]);
});
it("preserves relative image authority through streamed Lua", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/docs"); await fs.writeFile("/docs/p.svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  const input = {bytes: new TextEncoder().encode("![image](p.svg)"), base: "/docs", source: "/docs/file.md"};
  const filters = createLuaFilterCapability({readStream: () => [new TextEncoder().encode("function Image(el) return el end")]});
  const options = {from: "markdown", to: "html5", embedResources: true, filters: [{kind: "lua" as const, path: "/identity.lua"}]};
  const expected = await convert([input], options, {filters, resourceFiles: fs, resourceCwd: "/wrong"});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden")); let output = "";
  try {
    await convertToOutput([input], options, {filters, resourceFiles: fs, resourceCwd: "/wrong", workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(output).toBe(expected.kind === "text" ? expected.text : undefined); expect(output).toContain('src="data:');
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([{name: "docs", type: "directory"}]);
});
it("retires Markdown scratch before output publication when close fails", async () => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs); let failed = false;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    return new Proxy(handle, {get(target, key) {
      if (key === "close") return async () => {await target.close(); if (!failed) {failed = true; throw new Error("Close failed");}};
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    }});
  });
  const write = vi.fn(), close = vi.fn();
  await expect(convertToOutput([{bytes: new TextEncoder().encode("a".repeat(20000))}], {from: "markdown", to: "plain"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, async abort() {}}
  })).rejects.toMatchObject({code: "E_IO"});
  expect(failed).toBe(true); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});
it.each([false, true])("preserves unnamed Markdown resource locations scope=%s", async fileScope => {
  const input = {bytes: new TextEncoder().encode("![missing](absent.png)")}, options = {from: "markdown", to: "html5", embedResources: true, fileScope};
  const fs = new MemoryFileSystem(), capabilities = {resourceFiles: fs};
  const expected = await convert([input], options, capabilities).catch(error => error);
  const actual = await convertToOutput([input], options, {...capabilities, workingFiles: {fs, directory: "/"}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => error);
  expect(expected).toBeInstanceOf(Error); expect(actual).toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  expect(await fs.readdir("/")).toEqual([]);
});
