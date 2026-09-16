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

// Authored PNG: a stored DEFLATE block containing one gray scanline, not a fixture.
function png(width = 1, height = 1): Uint8Array {
  const u32 = (n: number) => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  function chunk(name: string, data: number[]): number[] {
    const body = [...name].map(c => c.charCodeAt(0)).concat(data);
    let crc = 0xffffffff;
    for(const byte of body) {crc ^= byte; for(let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);}
    return [...u32(data.length), ...body, ...u32((crc ^ 0xffffffff) >>> 0)];
  }
  return new Uint8Array([137,80,78,71,13,10,26,10,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8,0,0,0,0]),
    ...chunk("IDAT", [0x78,0x01,0x01,2,0,253,255,0,128,0,130,0,129]), ...chunk("IEND", [])]);
}
// A one-component baseline JPEG: DC zero and EOB, with explicit one-bit tables.
function jpeg(): Uint8Array {
  const segment = (marker: number, data: number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
  return new Uint8Array([255,216, ...segment(219, [0, ...Array<number>(64).fill(1)]),
    ...segment(192, [8,0,1,0,1,1,1,0x11,0]),
    ...segment(196, [0,1,...Array<number>(15).fill(0),0, 16,1,...Array<number>(15).fill(0),0]),
    ...segment(218, [1,1,0,0,63,0]), 0x3f,255,217]);
}
const image = (id: string): Inline => ({t: "Image", c: [a, [], [id, ""]]});
it("embeds bounded PNG/JPEG bytes with checked dimensions and exact hex expansion", async () => {
  for(const [id, bytes, control] of [["one.png", png(), "pngblip"], ["one.jpg", jpeg(), "jpegblip"]] as const) {
    const text = await rtf([p(image(id))], {resources: [{id, bytes}]});
    const hex = [...bytes].map(n => n.toString(16).padStart(2, "0")).join("");
    expect(text).toContain(`{\\pict\\${control}\\picw1\\pich1\\picwgoal15\\pichgoal15 ${hex}}`);
    expect(hex.length).toBe(bytes.length * 2);
  }
});
it("checks image expansion, binary and image budgets before publishing", async () => {
  const bytes = png(); const publish = vi.fn(async () => {});
  for(const limits of [{expandedBytes: 1}, {binaryBytes: 1}, {images: 0}, {outputBytes: 400}])
    await expect(rtf([p(image("x"))], {resources: [{id: "x", bytes}]}, {limits, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(rtf([p(image("x"))], {resources: [{id: "x", bytes: png(32767,32767)}]}, {limits: {expandedBytes: 100}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});
it("rejects truncated/corrupt pictures, wrong scanline lengths and conflicting resource ids", async () => {
  const broken = png(); broken[45] = broken[45]! ^ 1;
  for(const bytes of [new Uint8Array(), new Uint8Array([255,216,255,217]), png().slice(0,-1), broken, png(2), jpeg().slice(0,-2)])
    await expect(rtf([p(image("x"))], {resources: [{id: "x", bytes}]})).rejects.toMatchObject({code: "E_RESOURCE"});
  await expect(rtf([p(image("x"))], {resources: [{id: "x", bytes: png()}, {id: "x", bytes: jpeg()}]})).rejects.toMatchObject({code: "E_RESOURCE"});
});
it("resolves images only through an explicit resource capability and rejects missing bytes", async () => {
  await expect(rtf([p(image("x"))])).rejects.toMatchObject({code: "E_RESOURCE"});
  const resolve = vi.fn(async () => png());
  expect(await rtf([p(image("x"))], {}, {resources: {resolve}})).toContain("\\pngblip");
  expect(resolve).toHaveBeenCalledWith("x", undefined, undefined);
});
it("accepts the exact ASCII output-byte limit and balances syntax independently of the reader", async () => {
  const blocks = [p(s("\\{}😀"), {t: "Superscript", c: [s("1")]}, {t: "Subscript", c: [s("2")]}, image("x"))];
  const extra = {resources: [{id: "x", bytes: png()}]};
  const text = await rtf(blocks, extra);
  expect(await rtf(blocks, extra, {limits: {outputBytes: text.length}})).toBe(text);
  await expect(rtf(blocks, extra, {limits: {outputBytes: text.length - 1}})).rejects.toMatchObject({code: "E_LIMIT"});
  let depth = 0;
  for(let i = 0; i < text.length; i++) {
    if(text[i] === "\\") {
      if("{}\\".includes(text[i + 1] ?? " ")) i++;
      else {while(text[i + 1] && "abcdefghijklmnopqrstuvwxyz".includes(text[i + 1]!)) i++;}
    } else if(text[i] === "{") depth++;
    else if(text[i] === "}") expect(--depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);
  expect(text).toContain("{\\super 1}{\\sub 2}");
});
