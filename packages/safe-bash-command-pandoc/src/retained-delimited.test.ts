import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";
const encoder = new TextEncoder();

it.each(["csv", "tsv"])("retains %s with standalone and transformation options", async from => {
  for (const to of ["json", "plain", "html5"]) {
    const inputs = ["name,value\nfirst,\"a\nb\"\n", "key,other\nsecond,😀\n"].map(text => ({bytes: encoder.encode(from === "tsv" ? text.replaceAll(",", "\t") : text)}));
    const options: ConversionOptions = {from, to, stripComments: true, shiftHeadingLevelBy: -1,
      ...(to === "html5" ? {standalone: true, toc: true, numberSections: true, ascii: true} : {})};
    const expected = await convert(inputs, options, {});
    const fs = new MemoryFileSystem(); let text = "";
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
    try {
      const actual = await convertToOutput(inputs, options, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
        output: {async write(bytes) {text += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}});
      expect(expected).toMatchObject({text, diagnostics: actual.diagnostics});
      expect(acquire).not.toHaveBeenCalled();
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["json", "plain", "html5"])("retains delimited filter generations before transformations to %s", async to => {
  const inputs = [{bytes: encoder.encode("name,value\nfirst,one\n")}, {bytes: encoder.encode("name,value\nsecond,two\n")}];
  const response = encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [
    {t: "Header", c: [2, ["", [], []], [{t: "Str", c: "heading"}]]}, {t: "RawBlock", c: ["html", "a<!--hidden-->b"]}]}));
  const options: ConversionOptions = {from: "csv", to, filters: [{kind: "json", path: "one"}, {kind: "json", path: "two"}], shiftHeadingLevelBy: -1, stripComments: true, rawContent: "retain"};
  const expectedRequest = await convert(inputs, {from: "csv", to: "json"}, {});
  const expected = await convert([{bytes: response}], {...options, from: "json", filters: []}, {});
  const fs = new MemoryFileSystem(); let text = "", calls = 0;
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  try {
    const actual = await convertToOutput(inputs, options, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
      filters: {async apply() {throw new Error("Whole filter forbidden");}, async applyJsonStream({stdin, stdout}) {
        let request = ""; for await (const bytes of stdin) request += new TextDecoder().decode(bytes);
        if (!calls++) expect(expectedRequest).toMatchObject({text: request});
        else expect(JSON.parse(request)).toEqual(JSON.parse(new TextDecoder().decode(response)));
        await stdout.write(response);
      }}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(expected).toMatchObject({text, diagnostics: actual.diagnostics});
    expect(calls).toBe(2);
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["success", "filter", "cancel", "sink", "backing", "limit"])("bounds delimited filter backing and cleans up on %s", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), open = fs.open.bind(fs);
  let live = 0, largest = 0, reads = 0, writes = 0, outstanding = 0, highWater = 0, emitted = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file read forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); live++;
    const read = handle.read.bind(handle), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (bytes, ...rest) => {reads++; largest = Math.max(largest, bytes.length); return read(bytes, ...rest);});
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...rest) => {
      writes++; largest = Math.max(largest, bytes.length);
      if (mode === "backing") throw new Error("Backing failed");
      return write(bytes, ...rest);
    });
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}});
    return handle;
  });
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Collector forbidden"));
  try {
    const run = convertToOutput([{chunks: (async function* () {
      yield encoder.encode("head\n");
      const reused = new Uint8Array(8192);
      for (let i = 0; i < 16; i++) {reused.fill(120); yield reused;}
      reused.fill(0);
    })()}], {from: "csv", to: "plain", stripComments: true, filters: [{kind: "json", path: "one"}]}, {
      signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384},
      ...(mode === "limit" ? {limits: {outputBytes: 10}} : {}),
      filters: {async apply() {throw new Error("Whole filter forbidden");}, async applyJsonStream({stdin, stdout}) {
        for await (const bytes of stdin) {
          await stdout.write(bytes);
          if (mode === "filter") throw new Error("Filter failed");
          if (mode === "cancel") controller.abort();
        }
      }}, output: {async write(bytes) {
        if (mode === "sink") throw new Error("Sink failed");
        outstanding += bytes.length; highWater = Math.max(highWater, outstanding);
        await Promise.resolve(); emitted += bytes.length; outstanding -= bytes.length;
      }, async close() {}, async abort() {}}
    });
    if (mode === "success") {await run; expect(emitted).toBe(131078); expect(reads).toBeGreaterThan(0);}
    else {await expect(run).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : mode === "limit" ? "E_LIMIT" : "E_IO"}); expect(emitted).toBe(0);}
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(writes).toBeGreaterThan(0); expect(largest).toBeLessThanOrEqual(16384); expect(highWater).toBeLessThanOrEqual(16384);
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("uses the retained standalone table writer through the CLI", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(); let text = "", error = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Collector forbidden"));
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "csv", "-t", "html", "--standalone", "--toc"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {yield encoder.encode("name,value\nfirst,one\n");})(),
      stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(text).toContain("<!DOCTYPE html>"); expect(text).toContain('<th scope="col">name</th>'); expect(error).toBe("");
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
