import { expect, it } from "vitest";
import { readDocument, writeDocument } from "./engine.js";
import type { Attr, Block, Inline } from "./ast-types.js";
import type { WriteOptions } from "./types.js";
const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
async function md(blocks: readonly Block[], to = "commonmark", options: Partial<WriteOptions> = {}) {
  const result = await writeDocument({blocks, metadata: {}, resources: []}, {to, ...options}, {});
  if(result.kind !== "text") throw new Error("Expected text");
  return result.text;
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
  await expect(md(blocks)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("supports only wrap none and bounds amplification", async () => {
  expect(await md([p(s("x"))], "commonmark", {wrap: "none"} as Partial<WriteOptions>)).toBe("x\n");
  for(const wrap of ["auto", "preserve", "invalid"]) await expect(md([p(s("x"))], "commonmark", {wrap} as Partial<WriteOptions>)).rejects.toMatchObject({code: "E_OPTION"});
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
