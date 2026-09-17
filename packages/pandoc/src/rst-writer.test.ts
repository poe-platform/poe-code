import {expect, it} from "vitest";
import {writeDocument} from "./engine.js";
import type {Attr, Block, Inline} from "./ast-types.js";
import type {WriteOptions} from "./types.js";
const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
const rst = (blocks: readonly Block[], options: Partial<WriteOptions> = {}) => writeDocument({blocks, metadata: {}, resources: []}, {to: "rst", ...options}, {});
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
  const inlines: Inline[] = [{t: "Underline", c: [s("u")]}, {t: "Strikeout", c: [s("s")]}, {t: "SmallCaps", c: [s("c")]}, {t: "Span", c: [a, [s("span")]]}, {t: "Cite", c: [[], [s("cite")]]}, {t: "Math", c: ["InlineMath", "x"]}, {t: "RawInline", c: ["rst", "raw"]}, {t: "LineBreak"}];
  const blocks: Block[] = [{t: "Div", c: [a, [p(s("div"))]]}, {t: "Figure", c: [a, [null, [p(s("caption"))]], [p(s("body"))]]}, {t: "RawBlock", c: ["rst", ".. include:: secret"]}];
  for(const block of [...inlines.map(inline => p(inline)), ...blocks]) {
    await expect(rst([block])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE", format: "rst"});
    expect(await rst([block], {lossy: true})).toMatchObject({diagnostics: [expect.objectContaining({code: "W_TABLE_LOSS"})]});
  }
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
  const {createPandocCommand} = await import("./safe-bash.js");
  const fs = Volume.fromJSON({"/output.rst": "original"});
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const run = (input: string) => createPandocCommand().execute({args: ["-f=commonmark", "-t=rst", "-o", "/output.rst"], stdin: [new TextEncoder().encode(input)], stdout: {write: async b => {stdout.push(b);}}, stderr: {write: async b => {stderr.push(b);}}, writeFile: async (path, bytes) => {fs.writeFileSync(path, bytes);}, signal: new AbortController().signal});
  expect(await run("# Heading\n\n**strong**")).toEqual({exitCode: 0});
  expect(fs.readFileSync("/output.rst", "utf8")).toContain("Heading\n=======");
  const original = fs.readFileSync("/output.rst", "utf8");
  expect(await run("**outer *inner***")).toEqual({exitCode: 5});
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
