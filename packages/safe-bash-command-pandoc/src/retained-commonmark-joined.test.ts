import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";

const encode = (text: string) => new TextEncoder().encode(text);
it.each([
  ["", ""], ["first", "second"], ["first\n", "\nsecond\n"],
  ["[ref]", "[ref]: /target 'title'\n"], ["![ref]", "[ref]: p.svg\n"],
  ["---\ntitle: first", "---\nbody"], ["---\ntitle: first\n---\nbody", "---\ntitle: second\n---\nbody"],
  ["---\nmap: {a: first, shared: before}\nlist: [1, 2]\n---\nbody", "---\nmap: {b: second, shared: after}\nlist: [3]\n---\nbody"],
  ["```", "still code\n```"], ["> first", "> second"], ["a".repeat(20000), "b".repeat(20000)]
].flatMap(texts => [false, true].map(fileScope => ({texts, fileScope}))))("streams operands %# scope=$fileScope", async ({texts, fileScope}) => {
  const inputs = texts.map((text, index) => ({bytes: encode(text), source: `${index}.md`}));
  const options = {from: "markdown", to: "json", fileScope};
  const expected = await convert(inputs, options, {}), fs = new MemoryFileSystem(); let output = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden"));
  try {
    const result = await convertToOutput(inputs, options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(acquire).not.toHaveBeenCalled(); expect(output).toBe(expected.kind === "text" ? expected.text : undefined); expect(result.diagnostics).toEqual(expected.diagnostics);
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
it.each([false, true])("retains each image authority through real Lua scope=%s", async fileScope => {
  const fs = new MemoryFileSystem();
  for (const name of ["a", "b"]) {await fs.mkdir(`/${name}`); await fs.writeFile(`/${name}/p.svg`, encode(`<svg xmlns="http://www.w3.org/2000/svg"><title>${name}</title></svg>`));}
  const inputs = ["a", "b"].map(name => ({bytes: encode("![image](p.svg)"), base: `/${name}`, source: `/${name}/file.md`}));
  const filters = createLuaFilterCapability({readStream: () => [encode("function Image(el) return el end")]});
  const options = {from: "markdown", to: "html5", embedResources: true, fileScope, filters: [{kind: "lua" as const, path: "/identity.lua"}]};
  const expected = await convert(inputs, options, {filters, resourceFiles: fs, resourceCwd: "/wrong"});
  const resident = vi.spyOn(filters, "apply").mockRejectedValue(new Error("Resident filter forbidden")); let output = "";
  try {
    await convertToOutput(inputs, options, {filters, resourceFiles: fs, resourceCwd: "/wrong", workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(resident).not.toHaveBeenCalled(); expect(output).toBe(expected.kind === "text" ? expected.text : undefined);
  } finally {resident.mockRestore();}
  expect(await fs.readdir("/")).toEqual([{name: "a", type: "directory"}, {name: "b", type: "directory"}]);
});
it("acquires later operands before a reader limit failure", async () => {
  const fs = new MemoryFileSystem(); let acquired = false;
  const inputs = [{bytes: encode("# heading")}, {chunks: (async function* () {acquired = true; throw new Error("Later source failed"); yield encode("");})()}];
  await expect(convertToOutput(inputs, {from: "markdown", to: "json"}, {limits: {nodes: 0}, workingFiles: {fs, directory: "/"}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: "E_IO"});
  expect(acquired).toBe(true); expect(await fs.readdir("/")).toEqual([]);
});

it.each([false, true])("preserves joined missing-image locations named=%s", async named => {
  const inputs = ["first", "![missing](missing.png)"].map((text, index) => ({bytes: encode(text), ...(named ? {source: `${index}.md`} : {})}));
  const fs = new MemoryFileSystem(), options = {from: "markdown", to: "html5", embedResources: true};
  const expected = await convert(inputs, options, {resourceFiles: fs}).catch(error => error);
  const actual = await convertToOutput(inputs, options, {resourceFiles: fs, workingFiles: {fs, directory: "/"}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => error);
  expect(expected).toBeInstanceOf(Error); expect(actual).toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  expect(await fs.readdir("/")).toEqual([]);
});
it.each((["references", "retainedBytes", "nodes", "text", "depth", "attributes", "tableCells"] as const).flatMap(budget => [false, true].flatMap(fileScope => [false, true].map(metadata => ({budget, fileScope, metadata})))))("preserves $budget accounting and locations scope=$fileScope metadata=$metadata", async ({budget, fileScope, metadata}) => {
  const inputs = ["# title\n\n*body*", "| a | b |\n|---|---|\n| x | y |\n"].map((text, index) => ({bytes: encode((metadata ? "---\nmap: {key: value}\nlist: [1, 2]\n---\n" : "") + text), source: `${index}.md`}));
  const options = {from: "gfm", to: "json", fileScope}, ceiling = 1000000, boundaries = new Set([0, 1, ceiling]);
  const original = ExecutionContext.prototype.charge;
  const charge = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (args[0] === budget) {const used = ceiling - this.remaining(budget); boundaries.add(used); boundaries.add(used - 1);}
    return result;
  });
  try {await convert(inputs, options, {limits: {[budget]: ceiling}});} finally {charge.mockRestore();}
  const values = [...boundaries];
  for (const limit of values.filter((_, i) => i % Math.ceil(values.length / 30) === 0 || i >= values.length - 4)) {
    const fs = new MemoryFileSystem(), limits = {[budget]: limit}; let output = "";
    const expected = await convert(inputs, options, {limits}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden"));
    let actual;
    try {actual = await convertToOutput(inputs, options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}}).catch(error => error); expect(acquire).not.toHaveBeenCalled();}
    finally {acquire.mockRestore();}
    if (expected instanceof Error) {expect(actual, `${budget}=${limit}`).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location}); expect(output).toBe("");}
    else {expect(actual).not.toBeInstanceOf(Error); expect(output).toBe(expected.text); expect(actual.diagnostics).toEqual(expected.diagnostics);}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each([false, true].flatMap(fileScope => ["cancel", "source", "sink", "scratch", "close"].map(mode => ({fileScope, mode}))))("cleans multiple operands after $mode failure scope=$fileScope", async ({fileScope, mode}) => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let returned = false, failed = false;
  if (mode === "scratch") vi.spyOn(fs, "open").mockRejectedValue(new Error("Scratch failed"));
  if (mode === "close") {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      return new Proxy(handle, {get(target, key) {
        if (key === "close") return async () => {await target.close(); if (!failed) {failed = true; throw new Error("Close failed");}};
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      }});
    });
  }
  const inputs = [{bytes: encode("first")}, {chunks: (async function* () {
    try {yield encode("a".repeat(20000)); if (mode === "source") throw new Error("Source failed"); if (mode === "cancel") controller.abort();}
    finally {returned = true;}
  })()}];
  const write = vi.fn(async () => {if (mode === "sink") throw new Error("Sink failed");}), close = vi.fn(), abort = vi.fn();
  await expect(convertToOutput(inputs, {from: "markdown", to: "plain", fileScope}, {signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, abort}})).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(returned).toBe(true); expect(write).toHaveBeenCalledTimes(mode === "sink" ? 1 : 0); expect(close).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledTimes(mode === "sink" ? 1 : 0);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["json", "plain"])("rejects metadata warnings before publication to %s", async to => {
  const inputs = ["first", "second"].map(value => ({bytes: encode(`---\ntitle: ${value}\n---\nbody`)}));
  const options = {from: "markdown", to, fileScope: true, failIfWarnings: true};
  const expected = await convert(inputs, options, {}).catch(error => error), fs = new MemoryFileSystem();
  const write = vi.fn(), close = vi.fn();
  const actual = await convertToOutput(inputs, options, {workingFiles: {fs, directory: "/"}, output: {write, close, async abort() {}}}).catch(error => error);
  expect(expected).toMatchObject({code: "E_WARNINGS"}); expect(actual).toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});
