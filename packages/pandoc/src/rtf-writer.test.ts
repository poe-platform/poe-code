import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { writeDocument } from "./engine.js";
import { createPandocCommand } from "./safe-bash.js";
import type { Attr, Block, Inline, Row } from "./ast-types.js";
import type { Document, ConversionContext } from "./types.js";

const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
async function rtf(blocks: readonly Block[], extra: Partial<Document> = {}, context: ConversionContext = {}) {
  const result = await writeDocument({blocks, metadata: {}, resources: [], ...extra}, {to: "rtf"}, context);
  if(result.kind !== "text") throw new Error("Expected text");
  return result.text;
}
it("escapes syntax, terminates controls and emits signed UTF-16 with one fallback per unit", async () => {
  const text = await rtf([p(s("{a}\\😀é9\tZ\nnext"))]);
  expect(text).toContain("\\ansi\\ansicpg1252\\uc1");
  expect(text).toContain("\\{a\\}\\\\\\u-10179 ?\\u-8704 ?\\u233 ?9\\tab Z\\line next\\par}");
  expect([...text].every(c => c.charCodeAt(0) < 128)).toBe(true);
});
it("scopes nested formatting and resets each paragraph", async () => {
  expect(await rtf([p({t: "Strong", c: [s("a"), {t: "Emph", c: [s("b")]}]}, s("c")), p(s("d"))]))
    .toContain("{\\pard\\plain\\s0\\li0\\fi0\\ltrpar {\\b a{\\i b}}c\\par}\n{\\pard\\plain\\s0\\li0\\fi0\\ltrpar d\\par}");
});
it("preserves bidi text with explicit paragraph and scoped run directions", async () => {
  const span: Inline = {t: "Span", c: [["", [], [["dir", "ltr"]]], [s("abc")]]};
  expect(await rtf([p(s("אב"), span)], {direction: "rtl"})).toContain("\\rtlpar \\u1488 ?\\u1489 ?{\\ltrch abc}");
});
it("sorts explicit font references and colors deterministically without embedding bytes", async () => {
  const span: Inline = {t: "Span", c: [["", [], [["font-family", "Zeta"], ["color", "#ff0000"]]], [s("red")]]};
  const doc = {metadata: {"rtf-fonts": {t: "MetaList", c: [{t: "MetaString", c: "Zeta"}, {t: "MetaString", c: "Alpha"}]} as const}};
  const text = await rtf([p(span)], doc);
  expect(text).toContain("{\\fonttbl{\\f0\\fnil ;}{\\f1\\fnil Alpha;}{\\f2\\fnil Zeta;}}");
  expect(text).toContain("{\\colortbl;\\red255\\green0\\blue0;}");
  expect(text).toContain("{\\f2\\cf1 red}");
  expect(await rtf([p(span)], doc)).toBe(text);
  await expect(rtf([p(span)])).rejects.toMatchObject({code: "E_RESOURCE"});
});
it("writes safe hyperlink fields and rejects active field injection", async () => {
  expect(await rtf([p({t: "Link", c: [a, [s("web")], ["https://example.test/a", ""]]})]))
    .toContain('{\\field{\\*\\fldinst HYPERLINK "https://example.test/a"}{\\fldrslt web}}');
  for(const url of ['x"}\\object', "javascript:alert(1)", "file:///secret", "x\nINCLUDETEXT"])
    await expect(rtf([p({t: "Link", c: [a, [], [url, ""]]})])).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("keeps nested list numbering and continuation paragraphs at their own indentation", async () => {
  const text = await rtf([{t: "OrderedList", c: [[3, "Decimal", "OneParen"], [[p(s("outer")),
    {t: "BulletList", c: [[p(s("inner"))]]}, p(s("continued"))], [p(s("last"))]]]}]);
  expect(text).toContain("\\li360\\fi-360\\ltrpar {\\pntext 3)\\tab}");
  expect(text).toContain("\\li720\\fi-360\\ltrpar {\\pntext \\u8226 ?\\tab}");
  expect(text).toContain("\\li360\\fi0\\ltrpar continued");
  expect(text).toContain("{\\pntext 4)\\tab}");
});
it("emits independent cell and row terminators with paragraph resets inside cells", async () => {
  const row: Row = [a, [[a, "AlignDefault", 1, 1, [p(s("a")), p(s("b"))]], [a, "AlignDefault", 1, 1, [p(s("c"))]]]];
  const table: Block = {t: "Table", c: [a, [null, []], [["AlignLeft", {t: "ColWidthDefault"}], ["AlignRight", {t: "ColWidthDefault"}]],
    [a, []], [[a, 0, [], [row]]], [a, []]]};
  const text = await rtf([table]);
  expect(text).toContain("\\trowd\\cellx4320\\cellx8640");
  expect(text).toContain("\\intbl\\ql a\\par}");
  expect(text).toContain("\\intbl\\ql b\\par}\n\\cell ");
  expect(text).toContain("\\intbl\\qr c\\par}\n\\cell \\row}");
});
it("rejects raw objects, embedded font resources, controls and undeclared resources before publication", async () => {
  const publish = vi.fn(async () => {});
  for(const blocks of [[{t: "RawBlock", c: ["rtf", "{\\object\\objdata 00}"]}], [p(s("\0"))]] as Block[][])
    await expect(rtf(blocks, {}, {output: {publish}})).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(rtf([], {resources: [{id: "font.ttf", bytes: new Uint8Array([0, 1, 0, 0])}]})).rejects.toMatchObject({code: "E_RESOURCE"});
  expect(publish).not.toHaveBeenCalled();
});
it("bounds Unicode output expansion before publishing", async () => {
  const publish = vi.fn(async () => {});
  await expect(rtf([p(s("😀".repeat(100)))], {}, {limits: {outputBytes: 1000}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});
it("publishes the same converter through the thin command using memfs", async () => {
  const fs = Volume.fromJSON({"/output.rtf": "old"});
  const ctx = {args: ["-f=commonmark", "-t=rtf", "-o=/output.rtf"], stdin: [new TextEncoder().encode("**bold**")],
    stdout: {write: vi.fn(async () => {})}, stderr: {write: vi.fn(async () => {})},
    writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {fs.writeFileSync(path, bytes);}), signal: new AbortController().signal};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(fs.readFileSync("/output.rtf", "utf8")).toContain("{\\b bold}");
});
