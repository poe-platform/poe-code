import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {ExecutionContext} from "./execution.js";
import {expect, it, vi} from "vitest";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import type {Attr, Block, Inline} from "./ast-types.js";
import type {WriteOptions} from "./types.js";
const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
async function rst(blocks: readonly Block[], options: Partial<WriteOptions> = {}) {
  const wire = await writeDocument({blocks, metadata: {}, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected JSON");
  const input = {bytes: new TextEncoder().encode(wire.text)}, conversion = {from: "json", to: "rst", ...options};
  const expected = await convert([input], conversion, {}).catch(error => error);
  const fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Collector forbidden"));
  try {
    const actual = await convertToOutput([input], conversion, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {text += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}
    }).catch(error => error);
    expect(acquire).not.toHaveBeenCalled();
    if (expected instanceof Error) {expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location}); throw actual;}
    expect(actual).not.toBeInstanceOf(Error); expect(expected).toMatchObject({text, diagnostics: actual.diagnostics});
    return {kind: "text" as const, text, diagnostics: actual.diagnostics};
  } finally {acquire.mockRestore(); expect(await fs.readdir("/")).toEqual([]);}
}
it("uses Unicode display widths and deterministic adornments", async () => {
  expect(await rst([{t: "Header", c: [1, a, [s("界é")]]}, {t: "Header", c: [2, a, [s("next")]]}])).toMatchObject({text: "界é\n===\n\nnext\n----\n"});
  await expect(rst([{t: "Header", c: [10, a, [s("deep")]]}])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("separates style delimiters at word boundaries and rejects nested styles", async () => {
  expect(await rst([p(s("pre"), {t: "Emph", c: [s("word")]}, s("post_*"))])).toMatchObject({text: "pre\\ *word*\\ post\\_\\*\n"});
  const nested = [p({t: "Strong", c: [{t: "Emph", c: [s("nested")]}]})];
  await expect(rst(nested)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await rst(nested, {lossy: true})).toMatchObject({text: "**nested**\n", diagnostics: [expect.objectContaining({location: "$.blocks[0].c[0].c[0]"})]});
});
it("keeps displayed reference text separate from colliding targets and defers notes", async () => {
  expect(await rst([p({t: "Link", c: [a, [s("same")], ["https://one.test", ""]]}, {t: "Space"}, {t: "Link", c: [a, [s("same")], ["https://two.test", ""]]}, {t: "Note", c: [p(s("note"))]})])).toMatchObject({text: "`same <pc-link-1_>`_ `same <pc-link-2_>`_\\ [1]_\n\n.. _pc-link-1: https://one.test\n\n.. _pc-link-2: https://two.test\n\n.. [1] note\n"});
});
it("separates adjacent blocks and indents literal punctuation and list continuations", async () => {
  expect(await rst([{t: "CodeBlock", c: [a, ".. directive::\n* literal"]}, {t: "BulletList", c: [[p(s("first")), p(s("continued")), {t: "BulletList", c: [[p(s("child"))]]}]]}, {t: "DefinitionList", c: [[[s("term")], [[p(s("meaning"))]]]]}])).toMatchObject({text: "::\n\n   .. directive::\n   * literal\n\n* first\n\n  continued\n\n  * child\n\nterm\n   meaning\n"});
});
it("rejects empty structural parents instead of silently losing them", async () => {
  for(const block of [{t: "BlockQuote", c: []}, {t: "BulletList", c: [[]]}, {t: "Header", c: [1, a, []]}] as Block[]) await expect(rst([block])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("allocates duplicate identifiers and resolves forward internal targets", async () => {
  expect(await rst([p({t: "Link", c: [a, [s("go")], ["#x", ""]]}), {t: "Header", c: [1, ["x", [], []], [s("one")]]}, {t: "Header", c: [2, ["x", [], []], [s("two")]]}])).toMatchObject({text: expect.stringContaining(".. _pc-id-78-dup-2:")});
  await expect(rst([p({t: "Link", c: [a, [s("missing")], ["#missing", ""]]})])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("writes long list-table cells with block continuations", async () => {
  const table: Block = {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, [[a, [[a, "AlignDefault", 1, 1, [p(s("head"))]]]]]], [[a, 0, [], [[a, [[a, "AlignDefault", 1, 1, [p(s("a long cell exceeding any arbitrary fixed column width")), p(s("continuation"))]]]]]]], [a, []]]};
  expect(await rst([table])).toMatchObject({text: ".. list-table::\n   :header-rows: 1\n\n   * - head\n   * - a long cell exceeding any arbitrary fixed column width\n\n       continuation\n"});
});
it("represents code, roles, quotes, images, lines, ordered lists and transitions", async () => {
  expect(await rst([p({t: "Code", c: [a, "*_.!"]}, {t: "Space"}, {t: "Superscript", c: [s("2")]}, {t: "Space"}, {t: "Subscript", c: [s("i")]}, {t: "Space"}, {t: "Quoted", c: ["SingleQuote", [s("quote")]]}), {t: "CodeBlock", c: [["", ["text"], []], "- code"]}, {t: "LineBlock", c: [[s("line")], []]}, {t: "OrderedList", c: [[3, "Decimal", "Period"], [[{t: "Plain", c: [s("item")]}]]]}, {t: "BlockQuote", c: [p(s("quote"))]}, {t: "HorizontalRule"}, p({t: "Image", c: [a, [s("alt")], ["image.png", ""]]})])).toMatchObject({text: "``*_.!`` :sup:`2` :sub:`i` ‘quote’\n\n.. code:: text\n\n   - code\n\n| line\n| \n\n3. item\n\n..\n\n   quote\n\n----\n\n|pc-image-1|\n\n.. |pc-image-1| image:: image.png\n   :alt: alt\n"});
});
it("diagnoses every unsupported AST family rather than silently omitting it", async () => {
  const inlines: Inline[] = [{t: "Underline", c: [s("u")]}, {t: "SmallCaps", c: [s("c")]}, {t: "Span", c: [a, [s("span")]]}, {t: "Cite", c: [[], [s("cite")]]}, {t: "Math", c: ["InlineMath", "x"]}, {t: "RawInline", c: ["rst", "raw"]}, {t: "LineBreak"}];
  const blocks: Block[] = [{t: "Figure", c: [a, [null, [p(s("caption"))]], [p(s("body"))]]}, {t: "RawBlock", c: ["rst", ".. include:: secret"]}];
  for(const block of [...inlines.map(inline => p(inline)), ...blocks]) {
    await expect(rst([block])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE", format: "rst"});
    expect(await rst([block], {lossy: true})).toMatchObject({diagnostics: [expect.objectContaining({code: "W_TABLE_LOSS"})]});
  }
});
it("writes strikeout through a declared RST role and Divs through containers", async () => {
  const output = await rst([{t: "Div", c: [["section", ["notice"], []], [p({t: "Strikeout", c: [s("old")]})]]}]);
  expect(output).toMatchObject({text: expect.stringContaining(".. container:: notice\n\n   :strikeout:`old`"), diagnostics: []});
  expect(output).toMatchObject({text: expect.stringContaining(".. role:: strikeout\n")});
  expect(output).toMatchObject({text: expect.stringContaining(".. _pc-id-")});
  if (output.kind !== "text") throw new Error("Expected RST");
  expect(output.text.startsWith(".. role:: strikeout\n\n")).toBe(true);
});
it("measures combining marks outside the basic accent range", async () => {
  expect(await rst([{t: "Header", c: [1, a, [s("a᪰")]]}])).toMatchObject({text: "a᪰\n=\n"});
});
it("keeps adjacent list and quote containers distinct", async () => {
  expect(await rst([{t: "BulletList", c: [[p(s("one"))]]}, {t: "BulletList", c: [[p(s("two"))]]}, {t: "BlockQuote", c: [p(s("first"))]}, {t: "BlockQuote", c: [p(s("second"))]}])).toMatchObject({text: "* one\n\n..\n\n* two\n\n..\n\n   first\n\n..\n\n   second\n"});
});
it("rejects inline literals whose boundary backticks swallow the delimiter", async () => {
  await expect(rst([p({t: "Code", c: [a, "`literal`"]})])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("shares conversion and atomic publication through the thin adapter using memfs", async () => {
  const {Volume} = await import("memfs");
  const {createStandalonePandocCommand} = await import("./safe-bash.js");
  const fs = Volume.fromJSON({"/output.rst": "original"});
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const run = (input: string) => createStandalonePandocCommand().execute({args: ["-f=commonmark", "-t=rst", "--fail-if-warnings", "-o", "/output.rst"], stdin: [new TextEncoder().encode(input)], stdout: {write: async b => {stdout.push(b);}}, stderr: {write: async b => {stderr.push(b);}}, writeFile: async (path, bytes) => {fs.writeFileSync(path, bytes);}, signal: new AbortController().signal});
  expect(await run("# Heading\n\n**strong**")).toEqual({exitCode: 0});
  expect(fs.readFileSync("/output.rst", "utf8")).toContain("Heading\n=======");
  const original = fs.readFileSync("/output.rst", "utf8");
  expect(await run("**outer *inner***")).toEqual({exitCode: 2});
  expect(fs.readFileSync("/output.rst", "utf8")).toBe(original);
  expect(stdout).toEqual([]);
  expect(new TextDecoder().decode(stderr[0])).toContain("Nested RST inline style");
});
it("avoids generated-name collisions with implicit heading targets", async () => {
  expect(await rst([{t: "Header", c: [1, a, [s("pc-link-1")]]}, p({t: "Link", c: [a, [s("go")], ["https://one.test", ""]]})])).toMatchObject({text: expect.stringContaining("<pc-link-2_>")});
});
it("represents each deep heading adornment in the supported profile", async () => {
  expect(await rst([3, 4, 5, 6, 7, 8, 9].map(level => ({t: "Header", c: [level, a, [s("level")]]})))).toMatchObject({text: "level\n~~~~~\n\nlevel\n^^^^^\n\nlevel\n\"\"\"\"\"\n\nlevel\n'''''\n\nlevel\n+++++\n\nlevel\n:::::\n\nlevel\n#####\n"});
});
it("rejects empty list, definition and line containers", async () => {
  for(const block of [{t: "BulletList", c: []}, {t: "OrderedList", c: [[1, "Decimal", "Period"], []]}, {t: "DefinitionList", c: []}, {t: "LineBlock", c: []}] as Block[]) await expect(rst([block])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("fails for transitions at container boundaries", async () => {
  for(const blocks of [[{t: "HorizontalRule"}], [p(s("before")), {t: "HorizontalRule"}], [{t: "Header", c: [1, a, [s("heading")]]}, {t: "HorizontalRule"}, p(s("after"))]] as Block[][]) await expect(rst(blocks)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("preserves soft breaks as spaces and rejects empty notes", async () => {
  expect(await rst([p(s("one"), {t: "SoftBreak"}, s("two"))])).toMatchObject({text: "one two\n"});
  await expect(rst([p({t: "Note", c: []})])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("rejects spans in tables even in lossy mode", async () => {
  const table: Block = {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, []], [[a, 0, [], [[a, [[a, "AlignDefault", 2, 1, [p(s("span"))]]]], [a, []]]]], [a, []]]};
  for(const lossy of [false, true]) await expect(rst([table], {lossy})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("does not register dropped span identifiers as resolvable targets", async () => {
  await expect(rst([p({t: "Span", c: [["ghost", [], []], [s("span")]]}), p({t: "Link", c: [a, [s("go")], ["#ghost", ""]]})], {lossy: true})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("keeps image alternative text literal in directive options", async () => {
  expect(await rst([p({t: "Image", c: [a, [s("a_b* [caption]: \\path")], ["image.png", ""]]})])).toMatchObject({text: "|pc-image-1|\n\n.. |pc-image-1| image:: image.png\n   :alt: a_b* [caption]: \\path\n"});
});
it("preserves leading block quotes in table cells and footnote bodies", async () => {
  const quote: Block = {t: "BlockQuote", c: [p(s("quoted")), p(s("continued"))]};
  const table: Block = {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, []], [[a, 0, [], [[a, [[a, "AlignDefault", 1, 1, [quote, p(s("outside"))]]]]]]], [a, []]]};
  expect(await rst([table, p({t: "Note", c: [quote, p(s("outside"))]})])).toMatchObject({text: ".. list-table::\n   :header-rows: 0\n\n   * -\n\n       ..\n\n          quoted\n\n          continued\n\n       outside\n\n[1]_\n\n.. [1]\n\n       ..\n\n          quoted\n\n          continued\n\n       outside\n"});
});
it("anchors quote-only footnotes", async () => {
  const quote: Block = {t: "BlockQuote", c: [p(s("quoted"))]};
  expect(await rst([p({t: "Note", c: [quote]})])).toMatchObject({text: "[1]_\n\n.. [1]\n\n       ..\n\n          quoted\n"});
});
it("anchors quote-only definitions", async () => {
  const quote: Block = {t: "BlockQuote", c: [p(s("quoted"))]};
  expect(await rst([{t: "DefinitionList", c: [[[s("term")], [[quote]]]]}])).toMatchObject({text: "term\n   ..\n\n      quoted\n"});
});
it("preserves nested block quotes", async () => {
  const quote: Block = {t: "BlockQuote", c: [p(s("quoted"))]};
  expect(await rst([{t: "BlockQuote", c: [quote]}])).toMatchObject({text: "   ..\n\n      quoted\n"});
});
it("separates a definition list from a following block quote", async () => {
  expect(await rst([{t: "DefinitionList", c: [[[s("term")], [[p(s("meaning"))]]]]}, {t: "BlockQuote", c: [p(s("outside"))]}])).toMatchObject({text: "term\n   meaning\n\n..\n\n   outside\n"});
});

it("leaves ordinary prose punctuation readable", async () => {
  expect(await rst([p(s("Paragraph text. Note: a-b + c #1!"))])).toMatchObject({text: "Paragraph text. Note: a-b + c #1!\n"});
});
it.each(["- item", "+ item", "1. item", "a. item", "#. item", ".. note:: literal", ":field: literal", "----", "!!!!", "+---+---+", "literal::"])("preserves literal RST block syntax: %s", async text => {
  const output = await rst([p(s(text))]);
  if(output.kind !== "text") throw new Error("Expected RST");
  const plain = await convert([{bytes: new TextEncoder().encode(output.text)}], {from: "rst", to: "plain"}, {});
  expect(plain).toMatchObject({text: text + "\n"});
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
    await convertToOutput([{chunks: source()}], {from: "json", to: "rst"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
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
  if (mode === "code") {add("::\n\n   "); for (let i = 0; i < 8; i++) add("`".repeat(8192)); add("\n");}
  else {
    add("`label <pc-link-1_>`_\\ `label <pc-link-2_>`_\n\n");
    for (let link = 1; link <= 2; link++) {add(`.. _pc-link-${link}: https://`); for (let i = 0; i < 8; i++) add("x".repeat(8192)); add(link === 1 ? "\n\n" : "\n");}
  }
  expect({length, hash}).toEqual({length: expectedLength, hash: expectedHash});
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(largest).toBeLessThanOrEqual(16384); expect(highWater).toBeLessThanOrEqual(16384);
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("retains deeply nested writer continuations", async () => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let text = "";
  await convertToOutput([{chunks: (async function* () {
    yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[');
    for (let i = 0; i < 50; i++) yield encoder.encode('{"t":"Div","c":[["",[],[]],[');
    yield encoder.encode('{"t":"Para","c":[{"t":"Str","c":"deep"}]}');
    for (let i = 0; i < 50; i++) yield encoder.encode("]]}");
    yield encoder.encode("]}");
  })()}], {from: "json", to: "rst"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  expect(text).toContain("deep\n"); expect(text.split(".. container::")).toHaveLength(51); expect(await fs.readdir("/")).toEqual([]);
});

it.each(["cancel", "backing", "sink", "limit", "warnings", "math"])("cleans retained RST without publication on %s failure", async mode => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(), controller = new AbortController(), open = fs.open.bind(fs); let live = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); live++; const write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {if (mode === "backing") throw new Error("Backing failed"); if (mode === "cancel") controller.abort(); return write(...args);});
    vi.spyOn(handle, "close").mockImplementation(async options => {try {await close(options);} finally {live--;}}); return handle;
  });
  const write = vi.fn(async () => {if (mode === "sink") throw new Error("Destination failed");});
  const block = mode === "warnings" ? {t: "RawBlock", c: ["html", "raw"]} : mode === "math" ? {t: "Para", c: [{t: "Math", c: [{t: "InlineMath"}, "x"]}]} : {t: "CodeBlock", c: [["",[],[]], "x".repeat(65536)]};
  const bytes = encoder.encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [block]}));
  await expect(convertToOutput([{bytes}], {from: "json", to: "rst", lossy: true, failIfWarnings: true}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, ...(mode === "limit" ? {limits: {outputBytes: 10}} : {}),
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : mode === "limit" ? "E_LIMIT" : mode === "warnings" ? "E_WARNINGS" : mode === "math" ? "E_WARNINGS" : "E_IO"});
  if (mode !== "sink") expect(write).not.toHaveBeenCalled();
  expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);
});

it("streams CSV through the RST command path", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let text = "", error = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Document collector forbidden"));
  try {
    expect(await createPandocCommand().execute({command: "pandoc", args: ["-f", "csv", "-t", "rst"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {yield encoder.encode("name,value\nfirst,one\n");})(), stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(text).toBe(".. list-table::\n   :header-rows: 1\n\n   * - name\n     - value\n   * - first\n     - one\n"); expect(error).toBe(""); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("preserves leading empty blocks in notes and list items", async () => {
  await rst([p({t: "Note", c: [p(), p(s("after"))]})]);
  await rst([{t: "BulletList", c: [[p(), p(s("after"))]]}]);
});
it("retains long target names, source collisions, nested notes and duplicate identifiers", async () => {
  const id = "z".repeat(5000);
  await rst([p(s("pc-link-1 pc-id-7a"), {t: "Link", c: [a, [s("go")], ["#" + id, ""]]}, {t: "Note", c: [p({t: "Note", c: [p(s("nested"))]})]}), {t: "Header", c: [1, [id, [], []], [s("heading")]]}, {t: "Header", c: [2, [id, [], []], [s("duplicate")]]}]);
});
