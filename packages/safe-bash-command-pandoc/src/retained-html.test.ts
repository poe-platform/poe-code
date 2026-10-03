import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Block, Inline, Attr, MetaValue, Row} from "./ast-types.js";
import type {ConversionOptions} from "./types.js";
const attr: Attr = ["", [], []];
const str = (c: string): Inline => ({t: "Str", c});
const para = (...c: Inline[]): Block => ({t: "Para", c});
async function compare(blocks: Block[], options: Partial<ConversionOptions> = {}, metadata: Record<string, MetaValue> = {}) {
  const wire = await writeDocument({blocks, metadata, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)}, conversion = {from: "json", to: "html", ...options};
  const expected = await convert([input], conversion, {});
  const fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole document forbidden"));
  try {
    const actual = await convertToOutput([input], conversion, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); text += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}
    });
    expect(expected).toMatchObject({text, diagnostics: actual.diagnostics});
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}

it.each([{}, {ascii: true}, {standalone: true}, {standalone: true, toc: true, numberSections: true}, {eol: "crlf" as const}])("retains the complete HTML writer behavior: %j", async options => {
  await compare([
    {t: "Header", c: [1, attr, [str("A Σigma ΟΣ 😀")]]},
    {t: "Header", c: [2, ["a-σigma-ος-😀", [], []], [str("Explicit")]]},
    {t: "Header", c: [2, attr, [str("A Σigma ΟΣ 😀")]]},
    para(str('one<&>"\r'), {t: "SoftBreak"}, {t: "Strong", c: [str("bold")]}, {t: "SmallCaps", c: [str("small")]},
      {t: "Quoted", c: ["DoubleQuote", [str("quote")]]}, {t: "Math", c: ["InlineMath", "x+y"]}, {t: "Code", c: [attr, "code"]},
      {t: "Link", c: [["link", ["class"], [["data-key", "value"]]], [str("label")], ['https://example.test/a b?q="a"', 'title"']]},
      {t: "Image", c: [attr, [{t: "Emph", c: [str("alt")]}], ["pic.png", "title"]]},
      {t: "Note", c: [para(str("note")), {t: "Header", c: [3, attr, [str("note heading")]]}]},
      {t: "Span", c: [["", ["task-list-marker"], [["checked", "true"]]], []]}),
    {t: "CodeBlock", c: [["code", ["lang"], []], "one\ntwo"]},
    {t: "BlockQuote", c: [para(str("quote"))]},
    {t: "Div", c: [["fn1", [], [["dir", "rtl"]]], [para(str("div"))]]},
    {t: "BulletList", c: [[para(str("first"))], []]},
    {t: "OrderedList", c: [[3, "LowerRoman", "Period"], [[para(str("numbered"))]]]},
    {t: "DefinitionList", c: [[[str("term")], [[para(str("definition"))], []]]]},
    {t: "LineBlock", c: [[str("one")], [], [str("three")]]},
    {t: "Figure", c: [attr, [[str("short")], [para(str("long"))]], [para(str("body"))]]},
    {t: "HorizontalRule"}
  ], options, {title: {t: "MetaInlines", c: [str("Title &"), {t: "Strong", c: [str("bold")]}]}, lang: {t: "MetaString", c: "en"}, dir: {t: "MetaString", c: "ltr"}});
});

it("preserves table placement, spans, section attributes, row heads and captions", async () => {
  const cell = (value: string, rows = 1, columns = 1): [Attr, "AlignDefault", number, number, Block[]] => [attr, "AlignDefault", rows, columns, [para(str(value))]];
  const table: Block = {t: "Table", c: [["table", ["wide"], []], [[str("short")], []],
    [["AlignLeft", {t: "ColWidth", c: 0.25}], ["AlignDefault", {t: "ColWidth", c: 0.5}], ["AlignRight", {t: "ColWidth", c: 0.25}]],
    [["head", [], []], [[attr, [cell("spanning", 2), cell("top", 1, 2)]], [attr, [cell("second", 1, 2)]]]],
    [[["body", [], []], 1, [[attr, [cell("body header", 1, 3)]]], [[attr, [cell("row head"), cell("data"), cell("tail")]]]]],
    [["foot", [], []], [[attr, [cell("footer", 1, 3)]]]]]};
  await compare([table]);
  await compare([{t: "Table", c: [attr, [null, []], [], [attr, [[attr, []], [attr, []]]], [[attr, 0, [], [[attr, []]]]], [attr, []]]}]);
  const nested: Row = [attr, [[attr, "AlignCenter", 1, 1, [table]]]];
  await compare([{t: "Table", c: [attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], [nested]]], [attr, []]]}]);
});

it.each([{}, {lossy: true}, {rawContent: "retain" as const}, {rawContent: "escape" as const}, {rawContent: "retain" as const, failIfWarnings: true}])("preserves raw-content diagnostics and failures: %j", async options => {
  const blocks: Block[] = [para({t: "RawInline", c: ["html", "<b>raw</b>"]}), {t: "RawBlock", c: ["html5", "<hr>"]}];
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)}, conversion = {from: "json", to: "html", ...options};
  const expected = await convert([input], conversion, {}).catch(error => error);
  if (!(expected instanceof Error)) {await compare(blocks, options); return;}
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {});
  await expect(convertToOutput([input], conversion, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}}))
    .rejects.toMatchObject({message: expected.message, ...("code" in expected ? {code: expected.code} : {}), ...("location" in expected ? {location: expected.location} : {})});
  expect(write).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});

it.each(["javascript:x", "javascript:x\n", "https://bad\\path", "https://bad\u00a0", "\u00a0https://bad", "https://ok/path?x=1", "relative:bad/path", "a/path:ok"])("preserves URL admission: %j", async url => {
  const blocks = [para({t: "Link", c: [attr, [str("link")], [url, ""]]})];
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)}, options = {from: "json", to: "html"};
  const expected = await convert([input], options, {}).catch(error => error);
  if (!(expected instanceof Error)) {await compare(blocks); return;}
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {});
  await expect(convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}}))
    .rejects.toMatchObject({message: expected.message});
  expect(write).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});

it.each([8, 32])("keeps generated heading IDs and output bounded across %i reused chunks", async count => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(), open = fs.open.bind(fs);
  let live = 0, largest = 0, reads = 0, writes = 0, outstanding = 0, peak = 0, length = 0, hash = 2166136261;
  const digest = (initial: number, bytes: Uint8Array) => {let value = initial; for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0; return value;};
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole backing reads forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); live++;
    const read = handle.read.bind(handle), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (bytes, ...rest) => {reads++; largest = Math.max(largest, bytes.length); return read(bytes, ...rest);});
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...rest) => {writes++; largest = Math.max(largest, bytes.length); return write(bytes, ...rest);});
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}});
    return handle;
  });
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collection forbidden"));
  try {
    await convertToOutput([{chunks: (async function* () {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Header","c":[1,["",[],[]],[{"t":"Str","c":"');
      const reused = new Uint8Array(8192);
      for (let i = 0; i < count; i++) {reused.fill(65 + i % 26); yield reused;}
      yield encoder.encode('"}]]}]}');
    })()}], {from: "json", to: "html"}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {
        outstanding += bytes.length; peak = Math.max(peak, outstanding);
        await Promise.resolve(); length += bytes.length; hash = digest(hash, bytes); outstanding -= bytes.length;
      }, async close() {}, async abort() {}}
    });
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  let expectedHash = digest(2166136261, encoder.encode('<h1 id="'));
  for (let i = 0; i < count; i++) expectedHash = digest(expectedHash, new Uint8Array(8192).fill(97 + i % 26));
  expectedHash = digest(expectedHash, encoder.encode('">'));
  for (let i = 0; i < count; i++) expectedHash = digest(expectedHash, new Uint8Array(8192).fill(65 + i % 26));
  expectedHash = digest(expectedHash, encoder.encode('</h1>\n'));
  expect(hash).toBe(expectedHash); expect(length).toBe(count * 8192 * 2 + 16);
  expect(peak).toBeLessThanOrEqual(16384); expect(largest).toBeLessThanOrEqual(16384);
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0);
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("stores deep calls and growing nested endnotes without resident writer stacks", async () => {
  const encoder = new TextEncoder(), fs = new MemoryFileSystem(); let text = "";
  await convertToOutput([{chunks: (async function* () {
    yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[');
    const prefix = encoder.encode('{"t":"Div","c":[["",[],[]],['), suffix = encoder.encode(']]}');
    for (let i = 0; i < 500; i++) yield prefix;
    yield encoder.encode('{"t":"Para","c":[{"t":"Str","c":"leaf"}]}');
    for (let i = 0; i < 500; i++) yield suffix;
    yield encoder.encode(']}');
  })()}], {from: "json", to: "html"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(text).toBe("<div>".repeat(500) + "<p>leaf</p>\n" + "</div>\n".repeat(500));
  expect(await fs.readdir("/")).toEqual([]);
  await compare([para({t: "Note", c: [para(str("outer"), {t: "Note", c: [para(str("inner"))]})]})]);
});

it("spills heading and note indexes beyond their fixed caches", async () => {
  const blocks: Block[] = [];
  for (let i = 0; i < 85; i++) {
    blocks.push({t: "Header", c: [1 + i % 3, attr, [str(`heading ${i}`)]]}, para({t: "Note", c: [para(str(`note ${i}`))]}));
  }
  blocks.push({t: "Header", c: [1, attr, [str("heading 0")]]});
  await compare(blocks, {standalone: true, toc: true, numberSections: true});
});

it.each(["nul", "attribute", "duplicate", "direction", "limit", "cancel", "backing", "sink"])("cleans retained HTML and prevents publication on %s failure", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), open = fs.open.bind(fs);
  let live = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); live++;
    const write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      if (mode === "backing") throw new Error("Backing failed");
      if (mode === "cancel") controller.abort();
      return write(...args);
    });
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}});
    return handle;
  });
  const blocks: Block[] = mode === "nul" ? [para(str("a\0b"))]
    : mode === "attribute" ? [{t: "Div", c: [["", [], [["onclick", "bad"]]], []]}]
    : mode === "duplicate" ? [para({t: "Link", c: [["", [], [["title", "second"]]], [], ["target", "first"]]})]
    : [{t: "CodeBlock", c: [attr, "x".repeat(50000)]}];
  const wire = await writeDocument({blocks, resources: [], metadata: mode === "direction" ? {dir: {t: "MetaString", c: "bad"}} : {}}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const write = vi.fn(async () => {if (mode === "sink") throw new Error("Destination failed");});
  await expect(convertToOutput([{bytes: new TextEncoder().encode(wire.text)}], {from: "json", to: "html"}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, ...(mode === "limit" ? {limits: {outputBytes: 10}} : {}),
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : mode === "limit" ? "E_LIMIT" : mode === "direction" ? "E_OPTION" : mode === "backing" || mode === "sink" ? "E_IO" : "E_CAPABILITY"});
  if (mode !== "sink") expect(write).not.toHaveBeenCalled();
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("streams transformed JSON through the HTML command path", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let text = "", error = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  try {
    expect(await createPandocCommand().execute({
      command: "pandoc", args: ["-f", "json", "-t", "html", "--strip-comments", "--shift-heading-level-by=-1"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"RawBlock","c":["html","<!--gone-->"]},{"t":"Header","c":[1,["",[],[]],[{"t":"Str","c":"tail"}]]}]}');})(),
      stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(text).toBe("<p>tail</p>\n"); expect(error).toBe(""); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
