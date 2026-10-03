import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions, MetadataObject} from "./types.js";
const input = (text: string) => ({bytes: new TextEncoder().encode(text)});
const source = input('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"Body"}]}]}');
async function compare(variables: MetadataObject, template: string | null = "$value$:$body$", extra: Partial<ConversionOptions> = {}) {
  const options = {from: "json", to: "html", variables, ...(template === null ? {} : {template: input(template)}), ...extra};
  const document = options.from === "csv" ? input("Title\nBody") : source;
  const expected = await convert([document], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(); let output = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  try {
    const run = convertToOutput([document], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); output += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}
    }});
    if (expected.kind === "text") {const actual = await run; expect(expected).toMatchObject({text: output, diagnostics: actual.diagnostics});}
    else {await expect(run).rejects.toMatchObject({code: expected.code, message: expected.message}); expect(output).toBe("");}
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}
it.each(["text", "", 0, -0, 42, false, true, null, [], ["a", ["b", 2, false]], {key: "value"}])("retains variable case %#", async value => {
  await compare({value});
  await compare({value}, "$if(value)$yes$else$no$endif$:$for(value)$[$value$]$endfor$:$value$");
});
it("retains nested loops and restores shadowed values", async () => {
  await compare({value: [["a", "b"], ["c"]], other: [1, 2]}, "$for(value)$($for(value)$[$value$:$for(other)$$other$$endfor$]$endfor$)$endfor$:$value$");
});
it("retains large variables and long keys", async () => {
  const key = "k".repeat(32768);
  await compare({[key]: "x".repeat(65536) + "😀"}, "$" + key + "$", {from: "csv"});
});
it.each([{}, {from: "csv"}, {standalone: true}, {to: "json"}, {to: "plain"}])("validates variables without changing non-template output: %j", async extra => {
  await compare({value: "unused"}, null, extra);
});
it("preserves built-in values over user variables", async () => {
  await compare({body: "wrong", "header-includes": "wrong", "include-before": "wrong", "include-after": "wrong"}, "$header-includes$:$body$", {includeInHeader: [input("HEADER")], includeBeforeBody: [input("BEFORE")]});
});
it.each([{value: [null]}, {value: Infinity}, {constructor: "unsafe"}, {value: {prototype: "unsafe"}}, {value: undefined}] as unknown as MetadataObject[])("preserves variable validation errors: %#", async variables => {
  await compare(variables);
});
it("retains deep variable arrays without recursive rendering", async () => {
  let value: MetadataObject[string] = "leaf";
  for (let i = 0; i < 128; i++) value = [value];
  await compare({value}, "$value$");
});
it("reads parent paths from storage after nested objects", async () => {
  await compare({first: {nested: ["a", "b"], next: {value: 3}}, value: ["after", [1, 2]], last: true}, "$value$:$last$");
});
it("retains user bindings that shadow inherited methods", async () => {
  await compare({toString: ["first", "second"]}, "$for(toString)$$toString$:$endfor$");
});
it.each(["storage-error", "retire-error", "cancel", "sink-error", "success"])("cleans variable owners on %s", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), open = fs.open.bind(fs);
  let live = 0, opened = 0, transferred = 0, emitted = false, failed = false;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle), write = handle.write.bind(handle), ordinal = ++opened; live++;
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      transferred = Math.max(transferred, args[0].length);
      if (!failed && mode === "storage-error") {failed = true; throw new Error("Variable storage failed");}
      const result = await write(...args);
      if (mode === "cancel") controller.abort();
      return result;
    });
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {
      try {await close(...args);} finally {live--;}
      if (mode === "retire-error" && ordinal === 1 && emitted) throw new Error("Variable retirement failed");
    }); return handle;
  });
  const next = vi.fn(async () => ({done: true as const, value: undefined}));
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const document = mode === "storage-error" || mode === "cancel" ? {chunks: {[Symbol.asyncIterator]() {return {next};}}} : source;
  const run = convertToOutput([document], {from: "json", to: "html", variables: {value: ["x".repeat(65536), ["😀"]]}, template: input("$for(value)$[$value$]$endfor$:$body$")}, {
    signal: controller.signal, limits: {outputBytes: 100000}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {emitted = true; expect(bytes.length).toBeLessThanOrEqual(16384); if (mode === "sink-error") throw new Error("Destination failed"); await Promise.resolve();}, close, abort
    }
  });
  if (mode === "success") {await run; expect(close).toHaveBeenCalledOnce();}
  else {await expect(run).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(next).not.toHaveBeenCalled(); expect(live).toBe(0); expect(transferred).toBeLessThanOrEqual(16384); expect(transferred).toBeGreaterThan(0);
  expect(abort).toHaveBeenCalledTimes(mode === "sink-error" || mode === "retire-error" ? 1 : 0); expect(await fs.readdir("/")).toEqual([]);
});
it("rejects cyclic option graphs without exhausting the JavaScript stack", async () => {
  const variables: Record<string, MetadataObject[string]> = {}; variables.self = variables;
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([source], {from: "json", to: "html", variables, template: input("$body$")}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: "E_OPTION", message: "Invalid JSON metadata value"});
  expect(await fs.readdir("/")).toEqual([]);
});
it.each([200000, 100])("preflights variable output with limit %i", async outputBytes => {
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {}), close = vi.fn(async () => {});
  const run = convertToOutput([source], {from: "json", to: "html", variables: {value: "x".repeat(65536)}, template: input("$value$")}, {limits: {outputBytes}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, async abort() {}}});
  if (outputBytes > 100) {await run; expect(write).toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();}
  else {await expect(run).rejects.toMatchObject({code: "E_LIMIT"}); expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("uses the retained variable path for CLI -V and --variable-json", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(); await fs.writeFile("/document.json", source.bytes);
  await fs.writeFile("/template.html", input("<h1>$title$</h1>\n$for(items)$[$items$]$endfor$\n$body$").bytes);
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let output = "", error = "";
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "json", "-t", "html", "--template=/template.html", "-Vtitle=Report", "--variable-json=items:[1,2]", "/document.json"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(error).toBe(""); expect(output).toBe("<h1>Report</h1>\n[1][2]\n<p>Body</p>\n");
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); read.mockRestore();}
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["document.json", "template.html"]);
});
