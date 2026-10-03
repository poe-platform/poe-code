import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {ExecutionContext} from "./execution.js";
import { expect, it, vi } from "vitest";
import { readDocument, writeDocument, convert, convertToOutput } from "./engine.js";
import type { Attr, Block, Inline } from "./ast-types.js";
import type { WriteOptions } from "./types.js";
const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
async function md(blocks: readonly Block[], to = "commonmark", options: Partial<WriteOptions> = {}) {
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)}, conversion = {from: "json", to, ...options};
  const expected = await convert([input], conversion, {}).catch(error => error);
  const fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  try {
    const actual = await convertToOutput([input], conversion, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); text += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}
    }).catch(error => error);
    expect(acquire).not.toHaveBeenCalled();
    if (expected instanceof Error) {
      expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      throw actual;
    }
    expect(actual).not.toBeInstanceOf(Error);
    expect(expected).toMatchObject({text, diagnostics: actual.diagnostics});
    return text;
  } finally {acquire.mockRestore(); expect(await fs.readdir("/")).toEqual([]);}
}
async function back(text: string, from = "commonmark") {
  return (await readDocument({bytes: new TextEncoder().encode(text)}, {from}, {})).blocks;
}
it("escapes block-looking text and significant boundary spaces with independent strings", async () => {
  for(const [input, expected] of [["- item", "\\- item\n"], ["1. item", "1\\. item\n"], ["# title", "\\# title\n"], ["---", "\\---\n"], ["  x  ", "&#32;&#32;x&#32;&#32;\n"]]) {
    const actual = await md([p(s(input!))]); expect(actual).toBe(expected);
    const parsed = await back(actual);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.t).toBe("Para");
    if(parsed[0]?.t === "Para") expect(parsed[0].c.map(n => n.t === "Str" ? n.c : n.t === "Space" ? " " : "?").join("")).toBe(input);
  }
});
it("chooses code delimiters and padding, and fences exceeding embedded runs", async () => {
  expect(await md([p({t: "Code", c: [a, "a``b`"]})])).toBe("``` a``b` ```\n");
  expect(await md([{t: "CodeBlock", c: [a, "```\nx\n````"]}])).toBe("`````\n```\nx\n````\n`````\n");
});
it("preserves soft and hard breaks, LF and empty-document rules", async () => {
  expect(await md([])).toBe("");
  const blocks = [p(s("a"), {t: "SoftBreak"}, s("b"), {t: "LineBreak"}, s("c"))];
  const actual = await md(blocks); expect(actual).toBe("a\nb\\\nc\n"); expect(await back(actual)).toEqual(blocks);
});
it("writes nested tight and loose lists and empty items", async () => {
  expect(await md([{t: "BulletList", c: [[{t: "Plain", c: [s("a")]}, {t: "BulletList", c: [[{t: "Plain", c: [s("b")]}]]}], []]}])).toBe("- a\n  - b\n-\n");
  expect(await md([{t: "BulletList", c: [[p(s("a")), p(s("b"))], [p(s("c"))]]}])).toBe("- a\n\n  b\n\n- c\n");
});
it("serializes images, link targets and adjacent nested emphasis", async () => {
  expect(await md([p({t: "Image", c: [a, [{t: "Emph", c: [s("alt")]}, s("[]")], ['a(b)c', 'a"b']]})])).toBe('![*alt*\\[\\]](<a(b)c> "a\\"b")\n');
  const blocks = [p({t: "Emph", c: [{t: "Strong", c: [s("a")]}]}, {t: "Strong", c: [{t: "Emph", c: [s("b")]}]})];
  const actual = await md(blocks); expect(actual).toBe("*__a__***_b_**\n"); expect(await back(actual)).toEqual(blocks);
});
it("supports declared GFM strike/tasks and rejects or diagnoses CommonMark projection", async () => {
  const strike = [p({t: "Strikeout", c: [s("gone")]})];
  expect(await md(strike, "gfm")).toBe("~~gone~~\n");
  await expect(md(strike)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await md(strike, "commonmark", {lossy: true})).toBe("gone\n");
  const task: Inline = {t: "Span", c: [["", ["task-list-marker"], [["checked", "true"]]], []]};
  const blocks: Block[] = [{t: "BulletList", c: [[{t: "Plain", c: [task, s("todo")]}]]}];
  expect(await md(blocks, "gfm")).toBe("- [x] todo\n");
  expect(await md(blocks)).toBe("- ☒ todo\n");
});
it("supports wrapping policies and bounds amplification", async () => {
  expect(await md([p(s("x"))], "commonmark", {wrap: "none"} as Partial<WriteOptions>)).toBe("x\n");
  for(const wrap of ["invalid"]) await expect(md([p(s("x"))], "commonmark", {wrap} as Partial<WriteOptions>)).rejects.toMatchObject({code: "E_OPTION"});
  await expect(writeDocument({blocks: [p(s("[".repeat(100)))], metadata: {}, resources: []}, {to: "commonmark"}, {limits: {outputBytes: 100}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("uses collision-free numeric references for repeated targets, preserving distinct equal labels", async () => {
  const link = (target: string): Inline => ({t: "Link", c: [a, [s("same")], [target, ""]]});
  const blocks = [p(link("/a"), {t: "Space"}, link("/b"), {t: "Space"}, link("/a"), {t: "Space"}, s("[1]"))];
  const actual = await md(blocks);
  expect(actual).toBe("[same][1] [same](</b>) [same][1] \\[1\\]\n\n[1]: </a>\n");
  expect(await back(actual)).toEqual(blocks);
});
it("preserves rich GFM table cells and rejects CommonMark tables even under lossy", async () => {
  const cell = (c: readonly Inline[]): import("./ast-types.js").Cell => [a, "AlignDefault", 1, 1, [{t: "Plain", c}]];
  const head: import("./ast-types.js").Row = [a, [cell([s("H")])]];
  const row: import("./ast-types.js").Row = [a, [cell([{t: "Strong", c: [s("bold")]}, {t: "Space"}, {t: "Code", c: [a, "a|b"]}])]];
  const table: Block = {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, [head]], [[a, 0, [], [row]]], [a, []]]};
  const actual = await md([table], "gfm");
  expect(actual).toBe("| H |\n| --- |\n| **bold** `a\\|b` |\n");
  expect(await back(actual, "gfm")).toEqual([table]);
  await expect(md([table], "commonmark", {lossy: true})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("does not turn prose into bare GFM autolinks and handles formatted boundary spaces", async () => {
  expect(await md([p(s("https://example.com"))], "gfm")).toBe("https\\://example.com\n");
  const blocks = [p({t: "Emph", c: [{t: "Space"}, s("x"), {t: "Space"}]})];
  const actual = await md(blocks); expect(actual).toBe("*&#32;x&#32;*\n"); expect(await back(actual)).toEqual(blocks);
});
it("keeps adjacent equal emphasis nodes distinct", async () => {
  const blocks = [p({t: "Emph", c: [s("a")]}, {t: "Emph", c: [s("b")]})];
  const actual = await md(blocks); expect(actual).toBe("*a*_b_\n"); expect(await back(actual)).toEqual(blocks);
});
it("preserves task state for empty tasks and list tightness on parse-back", async () => {
  for(const text of ["- [ ]\n- [x]\n", "- a\n  - b\n-\n", "- a\n\n  b\n\n- c\n", "9. a\n   b\n10. c\n"]) {
    const blocks = await back(text, "gfm");
    const actual = await md(blocks, "gfm"); expect(await back(actual, "gfm")).toEqual(blocks);
  }
});
it("encodes target entities and quotes independently from inline prose", async () => {
  const blocks = [p({t: "Link", c: [a, [s("go")], ['a(b)"c&d<e> f', 'a"b(c)&d']]})];
  const actual = await md(blocks);
  expect(actual).toBe('[go](<a(b)\\"c\\&d\\<e\\>&#32;f> "a\\"b(c)\\&d")\n');
  expect(await back(actual)).toEqual([p({t: "Link", c: [a, [s("go")], ['a(b)%22c&d%3Ce%3E%20f', 'a"b(c)&d']]})]);
});
it("keeps blank lines inside blockquotes and adjacent lists distinct", async () => {
  const quote: Block = {t: "BlockQuote", c: [p(s("a")), p(s("b"))]};
  const actual = await md([quote]); expect(actual).toBe("> a\n>\n> b\n"); expect(await back(actual)).toEqual([quote]);
  const list: Block = {t: "BulletList", c: [[{t: "Plain", c: [s("a")]}]]};
  const lists = await md([list, list]); expect(lists).toBe("- a\n\n+ a\n"); expect(await back(lists)).toEqual([list, list]);
});
it("escapes ordered markers split across inline nodes and keeps intraword nested emphasis", async () => {
  expect(await md([p(s("1"), s("."), {t: "Space"}, s("item"))])).toBe("1\\. item\n");
  const blocks = [p({t: "Emph", c: [s("a"), {t: "Strong", c: [s("b")]}, s("c")]})];
  const actual = await md(blocks); expect(actual).toBe("*a**b**c*\n"); expect(await back(actual)).toEqual(blocks);
});
it("keeps bare domains and email addresses as GFM text", async () => {
  const actual = await md([p(s("www.example.com"), {t: "Space"}, s("user@example.com"))], "gfm");
  expect(actual).toBe("www\\.example.com user\\@example.com\n");
  expect(await back(actual, "gfm")).toEqual([p(s("www.example.com"), {t: "Space"}, s("user@example.com"))]);
});
it("does not add a second LF when a final break already terminates output", async () => {
  expect(await md([p(s("a"), {t: "SoftBreak"})])).toBe("a\n");
  expect(await md([p(s("a"), {t: "LineBreak"})])).toBe("a\\\n");
});

it("preserves wrapping, break adjacency and extension-specific escaping", async () => {
  const nodes: Inline[] = [s("1"), s("."), {t: "Space"}, s("www.example.com"), {t: "SoftBreak"}, {t: "Space"}, s("next"), {t: "Space"}, {t: "LineBreak"}, s("tail")];
  for (const to of ["commonmark", "gfm", "gfm-autolink_bare_uris-strikeout-task_lists"])
    for (const options of [{}, {wrap: "auto" as const, columns: 10}, {wrap: "preserve" as const}, {columns: 8}, {eol: "crlf" as const}]) await md([p(...nodes)], to, options);
});

it("preserves table projection, span occupancy, caption and diagnostic ordering", async () => {
  type Cell = import("./ast-types.js").Cell;
  type Row = import("./ast-types.js").Row;
  const cell = (blocks: Block[], rows = 1, columns = 1): Cell => [a, "AlignDefault", rows, columns, blocks];
  const row = (...cells: Cell[]): Row => [a, cells];
  const nested: Block = {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, []], [[a, 0, [], [row(cell([p(s("nested"))]))]]], [a, []]]};
  const complex: Block[] = [p({t: "Note", c: [p(s("note"))]}, {t: "Quoted", c: ["SingleQuote", [s("quoted")]]}),
    {t: "Figure", c: [a, [null, [p(s("caption"))]], [p(s("body"))]]},
    {t: "DefinitionList", c: [[[s("term")], [[p(s("meaning"))]]]]}, nested];
  const table: Block = {t: "Table", c: [["id", [], []], [[s("short")], [p(s("long | caption"))]], [["AlignLeft", {t: "ColWidth", c: 0.4}], ["AlignRight", {t: "ColWidthDefault"}]],
    [a, [row(cell([p(s("head"))], 1, 2))]], [[a, 0, [], [row(cell(complex, 2), cell([p(s("a\nb\tc\rd"))])), row(cell([p({t: "Code", c: [a, "a\r\nb|c"]})]))]]], [a, [row(cell([p(s("footer"))], 1, 2))]]]};
  await md([p(s("intro")), table], "gfm", {lossy: true});
  await md([{t: "BlockQuote", c: [table]}], "gfm", {lossy: true});
  await expect(md([table], "gfm")).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(md([table], "gfm", {lossy: true, failIfWarnings: true})).rejects.toMatchObject({code: "E_WARNINGS"});
  const emptyHead: Block = {t: "Table", c: [a, [null, []], [["AlignCenter", {t: "ColWidthDefault"}]], [a, []], [[a, 0, [], [row(cell([p(s("value"))]))]]], [a, []]]};
  await md([emptyHead], "gfm", {lossy: true});
});

it("retains references beyond the index cache and empty output from projected blocks", async () => {
  const links: Inline[] = [];
  for (let i = 0; i < 75; i++) links.push({t: "Link", c: [a, [s("link")], [`/${i}`, `title${i}`]]}, {t: "Space"});
  await md([p(...links, ...links)], "gfm");
  await md([{t: "LineBlock", c: [[s("line")]]}, {t: "DefinitionList", c: []}, p({t: "Note", c: [p(s("note"))]})], "commonmark", {lossy: true});
});

it.each(["code", "references"])("spills long %s with bounded I/O and slow output", async mode => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(), open = fs.open.bind(fs);
  let live = 0, reads = 0, writes = 0, largest = 0, outstanding = 0, highWater = 0, length = 0, hash = 2166136261;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); live++;
    const read = handle.read.bind(handle), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (bytes, ...rest) => {reads++; largest = Math.max(largest, bytes.length); return read(bytes, ...rest);});
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...rest) => {writes++; largest = Math.max(largest, bytes.length); return write(bytes, ...rest);});
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}});
    return handle;
  });
  const source = async function* () {
    yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[');
    const reused = new Uint8Array(8192);
    if (mode === "code") {
      yield encoder.encode('{"t":"CodeBlock","c":[["",[],[]],"');
      for (let i = 0; i < 8; i++) {reused.fill(96); yield reused;}
      yield encoder.encode('"]}');
    } else {
      yield encoder.encode('{"t":"Para","c":[');
      for (let link = 0; link < 2; link++) {
        yield encoder.encode((link ? "," : "") + '{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"label"}],["https://');
        for (let i = 0; i < 8; i++) {reused.fill(120); yield reused;}
        yield encoder.encode('",""]]}');
      }
      yield encoder.encode("]}");
    }
    reused.fill(0); yield encoder.encode("]}");
  };
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  try {
    await convertToOutput([{chunks: source()}], {from: "json", to: "gfm"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {
        outstanding += bytes.length; highWater = Math.max(highWater, outstanding); await Promise.resolve();
        length += bytes.length; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        outstanding -= bytes.length;
      }, async close() {}, async abort() {}}
    });
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  let expectedHash = 2166136261, expectedLength = 0;
  const add = (text: string) => {const bytes = encoder.encode(text); expectedLength += bytes.length; for (const byte of bytes) expectedHash = Math.imul(expectedHash ^ byte, 16777619) >>> 0;};
  if (mode === "code") {
    for (let i = 0; i < 8; i++) add("`".repeat(8192)); add("`\n");
    for (let i = 0; i < 8; i++) add("`".repeat(8192)); add("\n");
    for (let i = 0; i < 8; i++) add("`".repeat(8192)); add("`\n");
  } else {add("[label][1][label][1]\n\n[1]: <https://"); for (let i = 0; i < 8; i++) add("x".repeat(8192)); add(">\n");}
  expect({length, hash}).toEqual({length: expectedLength, hash: expectedHash});
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(largest).toBeLessThanOrEqual(16384); expect(highWater).toBeLessThanOrEqual(16384);
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("retains deeply nested writer continuations", async () => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let text = "";
  await convertToOutput([{chunks: (async function* () {
    yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[');
    for (let i = 0; i < 500; i++) yield encoder.encode('{"t":"Div","c":[["",[],[]],[');
    yield encoder.encode('{"t":"Para","c":[{"t":"Str","c":"deep"}]}');
    for (let i = 0; i < 500; i++) yield encoder.encode("]]}");
    yield encoder.encode("]}");
  })()}], {from: "json", to: "commonmark"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  expect(text).toBe("deep\n"); expect(await fs.readdir("/")).toEqual([]);
});

it.each(["cancel", "backing", "sink", "limit", "warnings", "math"])("cleans retained Markdown without publication on %s failure", async mode => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(), controller = new AbortController(), open = fs.open.bind(fs); let live = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); live++; const write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {if (mode === "backing") throw new Error("Backing failed"); if (mode === "cancel") controller.abort(); return write(...args);});
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}}); return handle;
  });
  const write = vi.fn(async () => {if (mode === "sink") throw new Error("Destination failed");});
  const block = mode === "warnings" ? {t: "RawBlock", c: ["html", "raw"]} : mode === "math" ? {t: "Para", c: [{t: "Math", c: [{t: "InlineMath"}, "x"]}]} : {t: "CodeBlock", c: [["",[],[]], "x".repeat(65536)]};
  const bytes = encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [block]}));
  await expect(convertToOutput([{bytes}], {from: "json", to: "gfm", lossy: true, failIfWarnings: true}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, ...(mode === "limit" ? {limits: {outputBytes: 10}} : {}),
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : mode === "limit" ? "E_LIMIT" : mode === "warnings" ? "E_WARNINGS" : mode === "math" ? "E_CAPABILITY" : "E_IO"});
  if (mode !== "sink") expect(write).not.toHaveBeenCalled();
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("streams CSV through the Markdown command path", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let text = "", error = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "csv", "-t", "markdown"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {yield encoder.encode("name,value\nfirst,one\n");})(), stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(text).toBe("| name | value |\n| --- | --- |\n| first | one |\n"); expect(error).toBe(""); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
