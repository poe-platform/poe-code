import { expect, it, vi } from "vitest";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { writeDocument, convert } from "./engine.js";
import type { Attr, Block, Cell, Row } from "./ast-types.js";
import type { Document, WriteOptions } from "./types.js";

const a: Attr = ["", [], []];
const c = (s: string, rs = 1, cs = 1): Cell => [a, "AlignDefault", rs, cs, [{ t: "Plain", c: [{ t: "Str", c: s }] }]];
const r = (...cells: Cell[]): Row => [a, cells];
function doc(rows: readonly Row[], head = [r(c("H1"), c("H2"))]): Document {
  return { blocks: [{ t: "Table", c: [a, [null, []], [["AlignLeft", { t: "ColWidthDefault" }], ["AlignRight", { t: "ColWidthDefault" }]], [a, head], [[a, 0, [], rows]], [a, []]] }], metadata: {}, resources: [] };
}
function change(d: Document, update: (t: Extract<Block, {t: "Table"}>) => Block): Document {
  return { ...d, blocks: [update(d.blocks[0] as Extract<Block, {t: "Table"}>)] };
}
async function output(d: Document, to: string, lossy = false) {
  return writeDocument(d, { to, lossy } as WriteOptions, {});
}
type Element = DefaultTreeAdapterMap["element"];
function elements(node: DefaultTreeAdapterMap["node"], tag: string): Element[] {
  return [ ...("tagName" in node && node.tagName === tag ? [node] : []),
    ...("childNodes" in node ? node.childNodes.flatMap(n => elements(n, tag)) : []) ];
}

it("writes GFM against literal syntax including alignment and escaped cell text", async () => {
  expect(await output(doc([r(c("a|b"), c("c\\d"))]), "gfm")).toMatchObject({
    text: "| H1 | H2 |\n| :--- | ---: |\n| a\\|b | c\\\\d |\n", diagnostics: [] });
});
it("retains HTML spans, sections, captions, row headers, widths and alignment in an independent DOM", async () => {
  const d = change(doc([]), t => ({ ...t, c: [a, [null, [{t: "Para", c: [{t: "Str", c: "Caption & <"}]}]],
    [["AlignLeft", {t: "ColWidth", c: 0.25}], t.c[2][1]!], [a, [r(c("Head", 1, 2))]],
    [[a, 1, [r(c("Bodyhead", 1, 2))], [r(c("Rowhead", 2), c("A")), r(c("B"))]], [a, 0, [], [r(c("Next", 1, 2))]]], [a, [r(c("Foot", 1, 2))]]] }));
  const result = await output(d, "html5");
  expect(result.kind).toBe("text");
  const dom = parseFragment(result.kind === "text" ? result.text : "");
  expect(elements(dom, "caption")).toHaveLength(1);
  expect(elements(dom, "thead")).toHaveLength(1);
  expect(elements(dom, "tbody")).toHaveLength(2);
  expect(elements(dom, "tfoot")).toHaveLength(1);
  const th = elements(dom, "th");
  expect(th.map(n => n.attrs)).toContainEqual(expect.arrayContaining([{name: "rowspan", value: "2"}, {name: "scope", value: "row"}]));
  expect(th.map(n => n.attrs)).toContainEqual(expect.arrayContaining([{name: "colspan", value: "2"}]));
  expect(elements(dom, "col")[0]?.attrs).toContainEqual({name: "style", value: "width:25%;text-align:left"});
  expect(result).toMatchObject({diagnostics: []});
  expect(result.kind === "text" && result.text).toContain("Caption &amp; &lt;");
});
it("strict GFM rejects spans and lossy GFM flattens each anchor once with exact paths", async () => {
  const d = doc([r(c("A", 2), c("B")), r(c("C"))]);
  await expect(output(d, "gfm")).rejects.toMatchObject({code: "E_CAPABILITY", location: "$.blocks[0].c[4][0][3][0][1][0]"});
  const result = await output(d, "gfm", true);
  expect(result).toMatchObject({text: "| H1 | H2 |\n| :--- | ---: |\n| A | B |\n|  | C |\n",
    diagnostics: [{code: "W_TABLE_LOSS", location: "$.blocks[0].c[4][0][3][0][1][0]", message: "Flattened cell span"}]});
});
it("strict GFM rejects complex cell blocks; lossy preserves their text in source order", async () => {
  const complex: Cell = [a, "AlignDefault", 1, 1, [{t: "Para", c: [{t: "Str", c: "one"}]}, {t: "BulletList", c: [[{t: "Plain", c: [{t: "Str", c: "two"}]}]]}]];
  const d = doc([r(complex, c("end"))]);
  await expect(output(d, "gfm")).rejects.toMatchObject({code: "E_CAPABILITY", location: "$.blocks[0].c[4][0][3][0][1][0][4]"});
  expect(await output(d, "gfm", true)).toMatchObject({text: "| H1 | H2 |\n| :--- | ---: |\n| one two | end |\n", diagnostics: [expect.objectContaining({location: "$.blocks[0].c[4][0][3][0][1][0][4]"})]});
});
it("strict GFM rejects multiple sections; lossy chooses the first header and keeps all later rows", async () => {
  const d = change(doc([]), t => ({...t, c: [a, [null, []], t.c[2], [a, [r(c("H1"), c("H2")), r(c("extra"), c("head"))]],
    [[a, 1, [r(c("body"), c("head"))], [r(c("row"), c("value"))]], [a, 0, [], [r(c("next"), c("body"))]]], [a, [r(c("foot"), c("end"))]]] }));
  await expect(output(d, "gfm")).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(await output(d, "gfm", true)).toMatchObject({text: "| H1 | H2 |\n| :--- | ---: |\n| extra | head |\n| body | head |\n| row | value |\n| next | body |\n| foot | end |\n"});
});
it("Plain projects captions and physical rows in source order with tabs; spans require explicit loss", async () => {
  const d = change(doc([r(c("A", 2, 2)), r()]), t => ({...t, c: [a, [null, [{t: "Plain", c: [{t: "Str", c: "Caption"}]}]], t.c[2], t.c[3], t.c[4], t.c[5]]}));
  await expect(output(d, "plain")).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(await output(d, "plain", true)).toMatchObject({text: "Caption\nH1\tH2\nA\n\n"});
});
it("GFM declares its single-header subset, preserves an empty body and supplies a blank header only in lossy mode", async () => {
  expect(await output(doc([]), "gfm")).toMatchObject({text: "| H1 | H2 |\n| :--- | ---: |\n"});
  await expect(output(doc([r(c("a"), c("b"))], []), "gfm")).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(await output(doc([r(c("a"), c("b"))], []), "gfm", true)).toMatchObject({text: "|  |  |\n| :--- | ---: |\n| a | b |\n"});
});
it("honors pipe_tables disabling, malformed geometry, diagnostics and output budgets before publication", async () => {
  await expect(output(doc([]), "gfm-pipe_tables", true)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  await expect(output(doc([r(c("short"))]), "html5", true)).rejects.toMatchObject({code: "E_AST"});
  const publish = vi.fn(async () => {});
  for (const limits of [{diagnostics: 0}, {outputBytes: 1}, {retainedBytes: 100}]) {
    await expect(writeDocument(doc([r(c("a", 2, 2)), r()]), {to: "gfm", lossy: true} as WriteOptions, {output: {publish}, limits}))
      .rejects.toMatchObject({code: "E_LIMIT"});
  }
  expect(publish).not.toHaveBeenCalled();
});
it("JSON-to-GFM conversion uses the same explicit lossy option", async () => {
  const d = doc([r(c("a", 1, 2))]);
  const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: d.blocks}, (key, value: unknown) =>
    key !== "t" && typeof value === "string" && value.startsWith("Align") ? {t: value} : value));
  const result = await convert([{bytes}], {from: "json", to: "gfm", lossy: true} as import("./types.js").ConversionOptions, {});
  expect(result).toMatchObject({text: "| H1 | H2 |\n| :--- | ---: |\n| a |  |\n", diagnostics: [expect.objectContaining({code: "W_TABLE_LOSS"})]});
});
it("escapes unsupported lossy HTML text and preserves source node paths after earlier blocks", async () => {
  const d = doc([r([a, "AlignDefault", 1, 1, [{t: "RawBlock", c: ["html", "<script>x</script>"]}]], c("end"))]);
  const result = await output(d, "html5", true);
  expect(result.kind === "text" && result.text).toContain("&lt;script&gt;x&lt;/script&gt;");
  const outer: Document = {...d, blocks: [{t: "Plain", c: []}, {t: "RawBlock", c: ["html", "raw"]}]};
  expect(await output(outer, "html5", true)).toMatchObject({diagnostics: [expect.objectContaining({location: "$.blocks[1]"})]});
});
it("applies column alignment to default-aligned HTML cells", async () => {
  const result = await output(doc([r(c("a"), c("b"))]), "html5");
  const dom = parseFragment(result.kind === "text" ? result.text : "");
  expect(elements(dom, "td").map(n => n.attrs)).toEqual([
    [{name: "style", value: "text-align:left"}], [{name: "style", value: "text-align:right"}]]);
});
it("preserves supported rich GFM inlines and their significant spaces", async () => {
  const rich: Cell = [a, "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Strong", c: [{t: "Str", c: " | bold "}]}]}]];
  const d = doc([r(rich, c("end"))]);
  expect(await output(d, "gfm")).toMatchObject({text: "| H1 | H2 |\n| :--- | ---: |\n| **&#32;\\| bold&#32;** | end |\n", diagnostics: []});
});
it("bounded generated spans preserve text exactly once in HTML and lossy GFM", async () => {
  for(let seed = 1; seed <= 12; seed++) {
    const labels = [`anchor-${seed}`, `top-${seed}`, `bottom-${seed}`];
    const d = doc([r(c(labels[0]!, 2), c(labels[1]!)), r(c(labels[2]!))]);
    for(const format of ["html5", "gfm"]) {
      const result = await output(d, format, format === "gfm");
      const text = result.kind === "text" ? result.text : "";
      let previous = -1;
      for(const label of labels) {expect(text.split(label)).toHaveLength(2); expect(text.indexOf(label)).toBeGreaterThan(previous); previous = text.indexOf(label);}
    }
  }
});
it("preserves embedded Plain cell notes with an explicit label", async () => {
  const note: Cell = [a, "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Note", c: [{t: "Plain", c: [{t: "Str", c: "note"}]}]}]}]];
  expect(await output(doc([r(note, c("end"))]), "plain")).toMatchObject({text: "H1\tH2\n[note: note]\tend\n", diagnostics: []});
});
it("requires explicit loss for GFM text line boundaries", async () => {
  await expect(output(doc([r(c("one\ntwo"), c("end"))]), "gfm")).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await output(doc([r(c("one\ntwo"), c("end"))]), "gfm", true)).toMatchObject({text: "| H1 | H2 |\n| :--- | ---: |\n| one two | end |\n", diagnostics: [expect.objectContaining({message: "Flattened cell text line boundaries"})]});
});
