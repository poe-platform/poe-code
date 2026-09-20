import { expect, it, vi } from "vitest";
import { writeDocument } from "./engine.js";
import { createPandocCommand } from "./safe-bash.js";
import type { Attr, Block, Inline } from "./ast-types.js";
import type { Document, WriteOptions } from "./types.js";
const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
const d = (...blocks: Block[]): Document => ({blocks, metadata: {}, resources: []});
const plain = (document: Document, options: Partial<WriteOptions> = {}) => writeDocument(document, {to: "plain", ...options}, {});
it("handles empty nodes, headings, paragraphs, quotes and Unicode without styling or wrapping", async () => {
  expect(await plain(d())).toMatchObject({text: ""});
  expect(await plain(d(p(), {t: "Div", c: [a, []]}))).toMatchObject({text: ""});
  expect(await plain(d({t: "Header", c: [2, a, [s("标题 العربية 👩🏽‍💻 é")]]}, p({t: "Quoted", c: ["DoubleQuote", [s("word")]]}, {t: "Space"}, {t: "Strong", c: [s("next")]})))).toMatchObject({text: '标题 العربية 👩🏽‍💻 é\n\n"word" next\n', diagnostics: []});
});
it("renders nested and empty list items with hanging indentation and meaningful code whitespace", async () => {
  expect(await plain(d({t: "BulletList", c: [[{t: "Plain", c: [s("outer")]}, {t: "OrderedList", c: [[3, "Decimal", "Period"], [[p(s("inner"))], []]]}], []]}, {t: "CodeBlock", c: [a, "  x\n\ty  \n"]}))).toMatchObject({text: "- outer\n  3. inner\n  4.\n-\n\n      x\n    \ty  \n\n"});
});
it("retains link destinations, titles, empty image boundaries and inline notes", async () => {
  const url = "https://example.test/" + "segment/".repeat(30);
  expect(await plain(d(p({t: "Link", c: [a, [s("label")], [url, "Title"]]}, {t: "Space"}, {t: "Link", c: [a, [s(url)], [url, ""]]}, {t: "Space"}, s("before"), {t: "Image", c: [a, [], ["pic.png", ""]]}, s("after"), {t: "Note", c: [p(s("one")), p(s("two"))]})))).toMatchObject({text: `label (${url}) "Title" ${url} before after[note: one\n\ntwo]\n`});
});
it("preserves multi-paragraph cells, captions and all physical rows", async () => {
  expect(await plain(d({t: "Table", c: [a, [[s("Short")], [p(s("Long"))]], [["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]], [a, []], [[a, 0, [], [[a, [[a, "AlignDefault", 1, 1, [p(s("one")), p(s("two"))]], [a, "AlignDefault", 1, 1, [p(s("end"))]]]]]]], [a, []]]}))).toMatchObject({text: "Short\n\nLong\none\n\ntwo\tend\n"});
});
it("fails unsupported raw, math and citation meaning and diagnoses explicitly retained raw source", async () => {
  const raw = d(p(s("left"), {t: "RawInline", c: ["html", "<b>middle</b>"]}, s("right")));
  await expect(plain(raw)).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(await plain(raw, {rawContent: "retain"})).toMatchObject({text: "left<b>middle</b>right\n", diagnostics: [expect.objectContaining({code: "W_RAW_CONTENT", location: "$.blocks[0].c[1]"})]});
  await expect(plain(d(p({t: "Math", c: ["InlineMath", "x^2"]})))).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(plain(d(p({t: "Cite", c: [[], [s("citation")]]})))).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("shares CLI/SDK bytes, wrap rejection and limits for identical JSON AST/options", async () => {
  const document = d(p(s("字 👩🏽‍💻 é")), p({t: "Link", c: [a, [s("label")], ["https://example.test", ""]]}));
  const input = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: document.blocks}));
  for(const limits of [undefined, {outputBytes: 3}, {work: 1}, {retainedBytes: 1}, {nodes: 1}, {depth: 1}]) {
    const stdout = vi.fn(async (_bytes: Uint8Array) => {}), stderr = vi.fn(async (_bytes: Uint8Array) => {});
    const result = await createPandocCommand({...(limits ? {limits} : {})}).execute({args: ["-f", "json", "-t", "plain", "--wrap=none"], stdin: (async function* () {yield input;})(), stdout: {write: stdout}, stderr: {write: stderr}, signal: new AbortController().signal});
    if(limits) {expect(result.exitCode).toBe(7); expect(stdout).not.toHaveBeenCalled(); await expect(writeDocument(document, {to: "plain", wrap: "none"}, {limits})).rejects.toMatchObject({code: "E_LIMIT"});}
    else {const sdk = await plain(document, {wrap: "none"}); expect(sdk.kind === "text" && new TextEncoder().encode(sdk.text)).toEqual(stdout.mock.calls[0]![0]); expect(result.exitCode).toBe(0);}
  }
  for(const wrap of ["auto", "preserve"]) {
    await expect(plain(document, {wrap} as Partial<WriteOptions>)).rejects.toMatchObject({code: "E_OPTION"});
    const write = vi.fn(async (_bytes: Uint8Array) => {});
    expect(await createPandocCommand().execute({args: ["-f", "json", "-t", "plain", `--wrap=${wrap}`], stdin: (async function* () {yield input;})(), stdout: {write}, stderr: {write: vi.fn(async () => {})}, signal: new AbortController().signal})).toEqual({exitCode: 2});
    expect(write).not.toHaveBeenCalled();
  }
});
it("preserves line blocks, inline code, definitions, figure content and alternative captions", async () => {
  expect(await plain(d(
    {t: "Plain", c: [s("one"), {t: "Space"}, {t: "Emph", c: []}, {t: "Code", c: [a, "  a\tb  "]}, {t: "SoftBreak"}, s("two")]},
    {t: "LineBlock", c: [[s("三")], [], [s("أربعة")]]},
    {t: "DefinitionList", c: [[[s("term")], [[p(s("first")), p(s("second"))]]]]},
    {t: "Figure", c: [a, [[s("short")], [p(s("caption"))]], [p({t: "Image", c: [a, [s("alt")], ["image.png", "image title"]]})]]},
    {t: "BlockQuote", c: [p(s("quoted"))]}, {t: "HorizontalRule"}
  ))).toMatchObject({text: 'one   a\tb  \ntwo\n三\n\nأربعة\n\nterm\n  first\n\n  second\n\nalt "image title"\n\nshort\n\ncaption\n\n  quoted\n\n---\n', diagnostics: []});
});
it("preserves raw block source, bounds diagnostics, and rejects columns rather than accepting an unused policy", async () => {
  const document = d({t: "RawBlock", c: ["latex", "a\\quad b"]});
  expect(await plain(document, {rawContent: "escape"})).toMatchObject({text: "a\\quad b\n", diagnostics: [expect.objectContaining({code: "W_RAW_CONTENT"})]});
  await expect(writeDocument(document, {to: "plain", rawContent: "retain"}, {limits: {diagnostics: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(plain(d(p(s("text"))), {columns: 20} as Partial<WriteOptions>)).rejects.toMatchObject({code: "E_OPTION"});
  const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: document.blocks}));
  for(const diagnostics of [0, 1]) {
    const stdout = vi.fn(async (_bytes: Uint8Array) => {}), stderr = vi.fn(async (_bytes: Uint8Array) => {});
    const cli = await createPandocCommand({limits: {diagnostics}}).execute({args: ["-f", "json", "-t", "plain", "--raw-content=retain"], stdin: (async function* () {yield bytes;})(), stdout: {write: stdout}, stderr: {write: stderr}, signal: new AbortController().signal});
    if(diagnostics === 0) {expect(cli.exitCode).toBe(7); expect(stdout).not.toHaveBeenCalled(); expect(new TextDecoder().decode(stderr.mock.calls[0]![0])).toContain("E_LIMIT:");}
    else {
      const sdk = await writeDocument(document, {to: "plain", rawContent: "retain"}, {limits: {diagnostics}});
      expect(cli.exitCode).toBe(0);
      expect(sdk.kind === "text" && new TextEncoder().encode(sdk.text)).toEqual(stdout.mock.calls[0]![0]);
      expect(new TextDecoder().decode(stderr.mock.calls[0]![0])).toBe(`${sdk.diagnostics[0]!.code}: ${sdk.diagnostics[0]!.location}: ${sdk.diagnostics[0]!.message}\n`);
    }
  }
});
