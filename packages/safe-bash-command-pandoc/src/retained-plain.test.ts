import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Block, Inline, Attr} from "./ast-types.js";
import type {ConversionOptions} from "./types.js";
const attr: Attr = ["", [], []];
const str = (c: string): Inline => ({t: "Str", c});
const para = (...c: Inline[]): Block => ({t: "Para", c});

async function compare(blocks: Block[], options: Partial<ConversionOptions> = {}) {
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)};
  const conversion = {from: "json", to: "plain", ...options};
  const expected = await convert([input], conversion, {});
  const fs = new MemoryFileSystem();
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  let text = "";
  try {
    const actual = await convertToOutput([input], conversion, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); text += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}
    });
    expect(text).toBe(expected.kind === "text" ? expected.text : "unexpected binary");
    expect(actual.diagnostics).toEqual(expected.diagnostics);
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}

it.each([{}, {wrap: "auto" as const, columns: 12}, {wrap: "preserve" as const}, {eol: "crlf" as const}])("renders retained text and nested containers with writer parity: %j", async options => {
  await compare([
    {t: "Plain", c: [str("a  😀 \t b"), {t: "SoftBreak"}, str("word"), {t: "LineBreak"}, {t: "Code", c: [attr, "code"]}]},
    {t: "Header", c: [2, attr, [str("heading")]]},
    para({t: "Quoted", c: ["DoubleQuote", [{t: "Emph", c: [str("quoted")]}]]}, {t: "Span", c: [attr, [str("span")]]}, {t: "Link", c: [attr, [str("label")], ["url", "ignored"]]}, {t: "Image", c: [attr, [], ["pic", "title"]]}, {t: "Note", c: [para(str("note"))]}),
    {t: "BulletList", c: [[{t: "Plain", c: [str("outer")]}, {t: "OrderedList", c: [[3, "Decimal", "Period"], [[para(str("inner"))], []]]}], []]},
    {t: "CodeBlock", c: [attr, "\n a\n\tb \n"]},
    {t: "BlockQuote", c: [para(str("quoted")), {t: "Div", c: [attr, [para(str("div"))]]}]},
    {t: "LineBlock", c: [[str("one")], [], [str("three")]]},
    {t: "DefinitionList", c: [[[str("term")], [[para(str("first")), para(str("second"))], []]]]},
    {t: "Figure", c: [attr, [[str("short")], [para(str("long"))]], [para(str("body"))]]},
    {t: "HorizontalRule"}
  ], options);
});

it("renders all physical table sections, captions and explicit span-loss diagnostics", async () => {
  const row = (text: string): [Attr, [Attr, "AlignDefault", number, number, Block[]][]] => [attr, [[attr, "AlignDefault", 1, 1, [para(str(text)), para(str("tail"))]]]];
  await compare([{t: "Table", c: [attr, [[str("short")], [para(str("long"))]], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, [row("head")]], [[attr, 0, [row("body-head")], [row("body")]]], [attr, [row("foot")]]]}]);
  await compare([para({t: "RawInline", c: ["html", ""]}), {t: "RawBlock", c: ["latex", "raw\n"]}], {rawContent: "retain"});
});

it("retains a generated long field and long wrapped word without document collection", async () => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder();
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  let count = 0;
  try {
    await convertToOutput([{chunks: (async function* () {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"');
      const reused = new Uint8Array(8192).fill(120);
      for (let i = 0; i < 8; i++) yield reused;
      yield encoder.encode('"}]}]}');
    })()}], {from: "json", to: "plain", wrap: "auto", columns: 8}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {count += bytes.length; expect(bytes.length).toBeLessThanOrEqual(16384);}, async close() {}, async abort() {}}
    });
    expect(count).toBe(65537);
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["math", "raw", "warnings", "limit", "cancel", "sink", "spill"])("prevents partial publication and cleans storage on %s failure", async failure => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const write = vi.fn(async () => {if (failure === "sink") throw new Error("Destination failed");});
  const input = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: failure === "math"
    ? [{t: "Para", c: [{t: "Math", c: [{t: "InlineMath"}, "x"]}]}]
    : failure === "raw" || failure === "warnings" ? [{t: "RawBlock", c: ["html", "raw"]}]
    : [{t: "CodeBlock", c: [["", [], []], "x".repeat(40000)]}]}));
  const open = fs.open.bind(fs); let live = 0, largest = 0, reads = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); live++;
    const read = handle.read.bind(handle), backingWrite = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (bytes, ...rest) => {reads++; largest = Math.max(largest, bytes.length); return read(bytes, ...rest);});
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...rest) => {
      largest = Math.max(largest, bytes.length);
      if (failure === "spill") throw new Error("Backing failed");
      if (failure === "cancel") controller.abort();
      return backingWrite(bytes, ...rest);
    });
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}});
    return handle;
  });
  await expect(convertToOutput([{bytes: input}], {from: "json", to: "plain", ...(failure === "warnings" ? {rawContent: "retain", failIfWarnings: true} : {})}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, ...(failure === "limit" ? {limits: {outputBytes: 3}} : {}),
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: failure === "math" || failure === "raw" ? "E_CAPABILITY" : failure === "warnings" ? "E_WARNINGS" : failure === "limit" ? "E_LIMIT" : failure === "cancel" ? "E_CANCELLED" : "E_IO"});
  if (failure !== "sink") expect(write).not.toHaveBeenCalled();
  if (failure === "limit" || failure === "sink") expect(reads).toBeGreaterThan(0);
  expect(largest).toBeLessThanOrEqual(16384);
  expect(live).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it("retains deep writer calls without a resident recursive renderer", async () => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let text = "";
  await convertToOutput([{chunks: (async function* () {
    yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[');
    const prefix = encoder.encode('{"t":"Div","c":[["",[],[]],['), suffix = encoder.encode(']]}');
    for (let i = 0; i < 600; i++) yield prefix;
    yield encoder.encode('{"t":"Para","c":[{"t":"Str","c":"leaf"}]}');
    for (let i = 0; i < 600; i++) yield suffix;
    yield encoder.encode(']}');
  })()}], {from: "json", to: "plain"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(text).toBe("leaf\n"); expect(await fs.readdir("/")).toEqual([]);
});

it("preserves empty physical table rows across section boundaries", async () => {
  const empty = (): [Attr, []] => [attr, []];
  await compare([{t: "Table", c: [attr, [null, []], [], [attr, [empty()]], [[attr, 0, [], [empty()]]], [attr, [empty()]]]}]);
  await compare([{t: "Table", c: [attr, [[str("caption")], []], [], [attr, []], [], [attr, []]]}]);
});

it("streams filtered JSON to plain through the command interpreter", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let text = "", error = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collection forbidden"));
  try {
    expect(await createPandocCommand({}, name => name === "node").execute({
      command: "pandoc", args: ["-f", "json", "-t", "plain", "--filter", "filter.js"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"x"}]}]}');})(),
      stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}},
      async invoke(name, args, options) {
        expect(name).toBe("node"); expect(args).toEqual(["--", "/filter.js", "plain"]);
        for await (const bytes of options!.stdin!) await options!.stdout!.write(bytes.map(byte => byte === 120 ? 121 : byte));
        return {exitCode: 0};
      }
    })).toEqual({exitCode: 0});
    expect(text).toBe("y\n"); expect(error).toBe(""); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("preserves whole-document math admission and diagnostic precedence", async () => {
  for (const metadata of [false, true]) {
    const math = {t: "Math", c: [{t: "InlineMath"}, "x"]};
    const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2],
      meta: metadata ? {note: {t: "MetaInlines", c: [math]}} : {},
      blocks: [{t: "RawBlock", c: ["html", "raw"]}, ...(metadata ? [] : [{t: "Para", c: [math]}])]}));
    const options = {from: "json", to: "plain", rawContent: "retain" as const};
    const expected = await convert([{bytes}], options, {}).catch(error => error);
    const fs = new MemoryFileSystem();
    const actual = await convertToOutput([{bytes}], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {throw new Error("Publication forbidden");}, async close() {}, async abort() {}}}).catch(error => error);
    expect(actual).toMatchObject({code: expected.code, message: expected.message, location: expected.location});
    expect(actual.format).toBe(expected.format);
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it("keeps table span warnings and rejection locations identical", async () => {
  const blocks: Block[] = [{t: "Table", c: [attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]],
    [attr, []], [[attr, 0, [], [[attr, [[attr, "AlignDefault", 1, 2, [para(str("spanned"))]]]]]]], [attr, []]]}];
  await compare(blocks, {lossy: true});
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected text");
  const input = {bytes: new TextEncoder().encode(wire.text)}, options = {from: "json", to: "plain"};
  const expected = await convert([input], options, {}).catch(error => error);
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {throw new Error("Publication forbidden");}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location, format: expected.format});
  expect(await fs.readdir("/")).toEqual([]);
});

it("orders numeric metadata keys before choosing a math diagnostic", async () => {
  const bytes = new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{"10":{"t":"MetaInlines","c":[{"t":"Math","c":[{"t":"InlineMath"},"ten"]}]},"2":{"t":"MetaInlines","c":[{"t":"Math","c":[{"t":"InlineMath"},"two"]}]}},"blocks":[]}');
  const options = {from: "json", to: "plain"}, expected = await convert([{bytes}], options, {}).catch(error => error);
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([{bytes}], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {throw new Error("Publication forbidden");}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["csv", "tsv"])("uses retained %s tables for multiple plain operands", async from => {
  const separator = from === "csv" ? "," : "\t";
  const inputs = [`head${separator}second\n"a b c\nd e"${separator}終\n`, `other\n${"word".repeat(5000)}\n`, ""]
    .map(text => ({bytes: new TextEncoder().encode(text)}));
  const options = {from, to: "plain", wrap: "auto" as const, columns: 4};
  const expected = await convert(inputs, options, {});
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole document forbidden"));
  const fs = new MemoryFileSystem(); let output = "";
  try {
    const actual = await convertToOutput(inputs, options, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(actual.diagnostics).toEqual(expected.diagnostics);
    expect(output).toBe(expected.kind === "text" ? expected.text : "unexpected binary");
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("reports table cell diagnostics before caption diagnostics", async () => {
  await compare([{t: "Table", c: [attr, [null, [{t: "RawBlock", c: ["html", "caption"]}]],
    [["AlignDefault", {t: "ColWidthDefault"}]],
    [attr, [[attr, [[attr, "AlignDefault", 1, 1, [{t: "RawBlock", c: ["html", "cell"]}]]]]]],
    [], [attr, []]]}], {rawContent: "retain"});
});
