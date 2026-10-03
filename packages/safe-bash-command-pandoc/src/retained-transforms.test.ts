import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";
const encoder = new TextEncoder();
const attr = ["id", [], []];
const header = (level: number) => ({c: [level, attr, [{t: "Str", c: "heading"}]], t: "Header"});
const raw = (c: string) => ({c: ["html", c], t: "RawBlock"});
const wire = (blocks: unknown[], meta = {}) => encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta, blocks}));

it.each(["json", "plain"])("retains heading and comment transformations for %s", async to => {
  for (const transform of [{shiftHeadingLevelBy: -2}, {shiftHeadingLevelBy: 6}, {stripComments: true}, {stripComments: true, shiftHeadingLevelBy: -2}]) {
    const input = {bytes: wire([header(1), header(9), raw("<!--removed-->"), {t: "Div", c: [attr, [header(4), raw("a<!--one-->b<!--unterminated")]]},
      {t: "Para", c: [{t: "RawInline", c: ["html", "<!--empty-->"]}, {t: "Str", c: "tail"}]}], {untouched: {t: "MetaBlocks", c: [header(3), raw("<!--metadata-->")]}})};
    const options = {from: "json", to, rawContent: "retain" as const, ...transform};
    const expected = await convert([input], options, {});
    const fs = new MemoryFileSystem(); let output = "";
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole document forbidden"));
    try {
      const actual = await convertToOutput([input], options, {
        workingFiles: {fs, directory: "/", cacheBytes: 16384},
        output: {async write(bytes) {output += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}
      });
      expect(expected).toMatchObject({text: output, diagnostics: actual.diagnostics});
      expect(acquire).not.toHaveBeenCalled();
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it("keeps original math rejection locations before heading demotion", async () => {
  const bytes = wire([{t: "Header", c: [1, attr, [{t: "Math", c: [{t: "InlineMath"}, "x"]}]]}]);
  const options = {from: "json", to: "plain", shiftHeadingLevelBy: -1};
  const expected = await convert([{bytes}], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole document forbidden"));
  try {
    await expect(convertToOutput([{bytes}], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}}))
      .rejects.toMatchObject({code: expected.code, location: expected.location, message: expected.message});
    expect(write).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("transforms after JSON filters and preserves their untransformed request", async () => {
  const input = wire([header(1)]), response = wire([header(2), raw("a<!--hidden-->b")]);
  let request = "", output = "";
  const fs = new MemoryFileSystem();
  const options: ConversionOptions = {from: "json", to: "json", shiftHeadingLevelBy: -2, stripComments: true, filters: [{kind: "json", path: "filter"}]};
  await convertToOutput([{bytes: input}], options, {
    filters: {async apply() {throw new Error("Whole filter forbidden");}, async applyJsonStream({stdin, stdout}) {
      for await (const bytes of stdin) request += new TextDecoder().decode(bytes);
      await stdout.write(response);
    }},
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(JSON.parse(request).blocks[0]).toEqual(header(1));
  const expected = await convert([{bytes: response}], {...options, filters: []}, {});
  expect(expected).toMatchObject({text: output});
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([8, 32])("spills generated comments with bounded backing and slow output (%i chunks)", async count => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs);
  let handles = 0, largest = 0, reads = 0, writes = 0, outstanding = 0, highWater = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); handles++;
    const read = handle.read.bind(handle), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (bytes, ...rest) => {reads++; largest = Math.max(largest, bytes.length); return read(bytes, ...rest);});
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...rest) => {writes++; largest = Math.max(largest, bytes.length); return write(bytes, ...rest);});
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {handles--;}});
    return handle;
  });
  let output = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    await convertToOutput([{chunks: (async function* () {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"RawBlock","c":["html","');
      yield encoder.encode("a".repeat(4094) + "<!--");
      const reused = new Uint8Array(8192);
      for (let i = 0; i < count; i++) {reused.fill(97 + i % 26); yield reused;}
      yield encoder.encode('z'.repeat(4092) + '-->tail<!--unterminated"]}]}');
    })()}], {from: "json", to: "plain", stripComments: true, rawContent: "retain"}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {
        outstanding += bytes.length; highWater = Math.max(highWater, outstanding);
        await Promise.resolve(); output += new TextDecoder().decode(bytes); outstanding -= bytes.length;
      }, async close() {}, async abort() {}}
    });
    expect(output).toBe("a".repeat(4094) + "tail\n");
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(highWater).toBeLessThanOrEqual(16384);
  expect(largest).toBeLessThanOrEqual(16384);
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0);
  expect(handles).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it.each(["success", "cancel", "backing", "output", "limit"])("retains deep rewrite jobs and cleans generations on %s", async mode => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  let opened = 0, live = 0, transformedWrites = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), ordinal = ++opened; live++;
    const write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      if (ordinal >= 3) {
        transformedWrites++;
        if (mode === "backing") throw new Error("Rewrite backing failed");
        if (mode === "cancel") controller.abort();
      }
      return write(...args);
    });
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}});
    return handle;
  });
  let output = "";
  const write = vi.fn(async (bytes: Uint8Array) => {if (mode === "output") throw new Error("Sink failed"); output += new TextDecoder().decode(bytes);});
  const conversion = convertToOutput([{chunks: (async function* () {
    yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[');
    const prefix = encoder.encode('{"t":"Div","c":[["",[],[]],['), suffix = encoder.encode(']]}');
    for (let i = 0; i < 400; i++) yield prefix;
    yield encoder.encode('{"t":"Header","c":[1,["",[],[]],[{"t":"Str","c":"');
    const chunk = new Uint8Array(8192).fill(120);
    for (let i = 0; i < 8; i++) yield chunk;
    yield encoder.encode('"}]]}');
    for (let i = 0; i < 400; i++) yield suffix;
    yield encoder.encode(']}');
  })()}], {from: "json", to: "plain", shiftHeadingLevelBy: -1}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384},
    ...(mode === "limit" ? {limits: {outputBytes: 10}} : {}), output: {write, async close() {}, async abort() {}}
  });
  if (mode === "success") {await conversion; expect(output).toBe("x".repeat(65536) + "\n");}
  else {
    await expect(conversion).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : mode === "limit" ? "E_LIMIT" : "E_IO"});
    if (mode !== "output") expect(write).not.toHaveBeenCalled();
  }
  expect(transformedWrites).toBeGreaterThan(0);
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("keeps CLI transforms on the retained path with paragraph wrapping after demotion", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(); let text = "", error = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collection forbidden"));
  try {
    expect(await createPandocCommand().execute({
      command: "pandoc", args: ["-f", "json", "-t", "plain", "--shift-heading-level-by=-1", "--strip-comments", "--wrap=auto", "--columns=8"],
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {yield wire([raw("<!--removed-->"), {t: "Header", c: [1, attr, [{t: "Str", c: "heading words"}]]}]);})(),
      stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(text).toBe("heading\nwords\n"); expect(error).toBe(""); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
