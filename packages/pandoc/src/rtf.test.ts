import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { readDocument, createPandocCommand, createFormatRegistry } from "./index.js";
import type { ConversionContext } from "./types.js";
import type { Inline } from "./ast-types.js";

const bytes = (source: string) => Uint8Array.from(source, c => c.charCodeAt(0));
const read = (source: string, context: ConversionContext = {}) => readDocument({bytes: bytes(source)}, {from: "rtf"}, {yield: async () => {}, ...context});
const str = (c: string) => ({t: "Str", c});
const para = (...c: unknown[]) => ({t: "Para", c});
const attr = ["", [], []];

describe("original byte-oriented RTF document reader", () => {
  it("registers the reader and writer and restores nested run state", async () => {
    expect(createFormatRegistry().list("read")).toContain("rtf");
    expect(createFormatRegistry().list("write")).toContain("rtf");
    expect((await read(String.raw`{\rtf1\ansi A{\b B{\i C}D}E\par F}`)).blocks).toEqual([
      para(str("A"), {t: "Strong", c: [str("B")]}, {t: "Strong", c: [{t: "Emph", c: [str("C")]}]}, {t: "Strong", c: [str("D")]}, str("E")), para(str("F"))
    ]);
  });
  it("distinguishes escaped control symbols from words and hex bytes", async () => {
    expect((await read(String.raw`{\rtf1 \\\{\}\'e9\~\_\-}`)).blocks).toEqual([para(str("\\{}é\u00a0\u2011\u00ad"))]);
  });
  it("ignores known noncontent destinations with nested state and binary braces", async () => {
    expect((await read(String.raw`{\rtf1 A{\*\generator\b {hidden}\bin4 {}\\}B}`)).blocks).toEqual([para(str("AB"))]);
  });
  it.each([
    [String.raw`{\rtf1\uc1\u945?X}`, "αX"],
    [String.raw`{\rtf1\uc2\u945\'3f\{X}`, "αX"],
    [String.raw`{\rtf1\uc0\u945{\uc2\u946??}\u947X}`, "αβγX"],
    [String.raw`{\rtf1\u-10179?\u-8704?}`, "😀"],
    [String.raw`{\rtf1\u945?{\b X}Y}`, "αXY"],
    [String.raw`{\rtf1\uc2\u945?{X}Y}`, "αXY"]
  ])("preserves Unicode fallback and group-local settings: %s", async (source, expected) => {
    const doc = await read(source);
    const flatten = (nodes: readonly Inline[]): string => nodes.map(n => n.t === "Str" ? n.c : n.t === "Strong" ? flatten(n.c) : "").join("");
    const block = doc.blocks[0];
    if (block?.t !== "Para") throw new Error("missing paragraph");
    expect(flatten(block.c)).toBe(expected);
  });
  it("decodes raw bytes and contiguous hex escapes with scoped code pages", async () => {
    expect((await read(String.raw`{\rtf1\ansi\ansicpg1252 \'e9{\ansicpg65001 \'c3\'a9}\'e9}`)).blocks).toEqual([para(str("ééé"))]);
    expect((await read("{\\rtf1\\ansi café}")).blocks).toEqual([para(str("café"))]);
    expect((await read(String.raw`{\rtf1\ansicpg65001 \'f0\'9f\'98\'80}`)).blocks).toEqual([para(str("😀"))]);
  });
  it("uses font charset and stylesheet definitions without emitting their names", async () => {
    const source = String.raw`{\rtf1\ansi{\fonttbl{\f0\fnil Arial;}{\f1\fnil\fcharset0 Serif;}}{\colortbl;\red255\green0\blue0;}{\stylesheet{\s1\b Heading;}}\s1 Title\par\pard\plain\f1\cf1\'e9}`;
    const doc = await read(source);
    expect(doc.blocks[0]).toEqual(para({t: "Strong", c: [str("Title")]}));
    expect(doc.blocks[1]).toEqual(para({t: "Span", c: [["", [], [["font-family", "Serif"], ["color", "#ff0000"]]], [str("é")]]}));
  });
  it("reads safe hyperlink instructions and never evaluates other fields", async () => {
    expect((await read(String.raw`{\rtf1 Before {\field{\*\fldinst HYPERLINK "https://example.test/a"}{\fldrslt label}} after}`)).blocks).toEqual([
      para(str("Before"), {t: "Space"}, {t: "Link", c: [attr, [str("label")], ["https://example.test/a", ""]]}, {t: "Space"}, str("after"))
    ]);
    await expect(read(String.raw`{\rtf1{\field{\*\fldinst INCLUDETEXT "secret"}{\fldrslt visible}}}`)).rejects.toMatchObject({code: "E_CAPABILITY"});
  });
  it("preserves cell and row boundaries and following paragraphs", async () => {
    const doc = await read(String.raw`{\rtf1\trowd\cellx1000\cellx2000\intbl A\cell B\cell\row\pard after}`);
    expect(doc.blocks.map(b => b.t)).toEqual(["Table", "Para"]);
    const table = doc.blocks[0];
    if (table?.t !== "Table") throw new Error("missing table");
    expect(table.c[4][0]?.[3][0]?.[1].map(c => c[4])).toEqual([[para(str("A"))], [para(str("B"))]]);
    expect(doc.blocks[1]).toEqual(para(str("after")));
  });
  it("reads list definitions, overrides and starting numbering", async () => {
    const doc = await read(String.raw`{\rtf1{\*\listtable{\list{\listlevel\levelnfc0\levelstartat3{\leveltext\'02\'00.;}{\levelnumbers\'01;}}\listid7}}{\*\listoverridetable{\listoverride\listid7\listoverridecount0\ls2}}\pard\ls2\ilvl0 one\par two\par\pard after}`);
    expect(doc.blocks).toEqual([{t: "OrderedList", c: [[3, "Decimal", "Period"], [[para(str("one"))], [para(str("two"))]]]}, para(str("after"))]);
  });
  it("reads flat font tables, default font charsets and document ANSI code pages", async () => {
    expect((await read(String.raw`{\rtf1\ansicpg65001\deff0{\fonttbl\f0\fnil\fcharset0 Arial;\f1\fnil\fcharset1 Serif;}\'c3\'a9}`)).blocks).toEqual([para({t: "Span", c: [["", [], [["font-family", "Arial"]]], [str("é")]]})]);
    expect((await read(String.raw`{\rtf1\ansi\deff1{\fonttbl{\f1\fnil\cpg65001 Serif;}}\'c3\'a9}`)).blocks).toEqual([para({t: "Span", c: [["", [], [["font-family", "Serif"]]], [str("é")]]})]);
  });
  it("preserves Unicode pairs across group-local non-text settings", async () => {
    expect((await read(String.raw`{\rtf1\u-10179?{\uc0\u-8704}}`)).blocks).toEqual([para(str("😀"))]);
  });
  it("reads local hyperlink targets and formatting in results", async () => {
    expect((await read(String.raw`{\rtf1{\field{\*\fldinst HYPERLINK \\l "bookmark"}{\fldrslt{\b label}}}}`)).blocks).toEqual([para({t: "Link", c: [attr, [{t: "Strong", c: [str("label")]}], ["#bookmark", ""]]})]);
  });
  it("reads numbered legacy paragraph lists and their generated labels", async () => {
    const doc = await read(String.raw`{\rtf1\pard{\pntext 5.\tab}{\*\pn\pnlvlbody\pndec\pnstart5{\pntxta .}}one\par{\pntext 6.\tab}{\*\pn\pnlvlbody\pndec\pnstart5{\pntxta .}}two\par\pard after}`);
    expect(doc.blocks).toEqual([{t: "OrderedList", c: [[5, "Decimal", "Period"], [[para(str("one"))], [para(str("two"))]]]}, para(str("after"))]);
  });
  it("honors list start overrides and parenthesis delimiters", async () => {
    const doc = await read(String.raw`{\rtf1{\*\listtable{\list{\listlevel\levelnfc0\levelstartat1{\leveltext\'02\'00);}}\listid7}}{\*\listoverridetable{\listoverride\listid7\listoverridecount1{\lfolevel\listoverridestartat\levelstartat9}\ls2}}\pard\ls2 one\par two}`);
    expect(doc.blocks).toEqual([{t: "OrderedList", c: [[9, "Decimal", "OneParen"], [[para(str("one"))], [para(str("two"))]]]}]);
  });
  it("restores list levels and joins consecutive table rows", async () => {
    const doc = await read(String.raw`{\rtf1{\*\listtable{\list{\listlevel\levelnfc0}{\listlevel\levelnfc23}\listid7}}{\*\listoverridetable{\listoverride\listid7\listoverridecount0\ls2}}\ls2 one\par{\ilvl1 sub\par}two\par\pard\trowd\cellx100\intbl A\cell\row\trowd\cellx100\intbl B\cell\row}`);
    expect(doc.blocks[0]).toEqual({t: "OrderedList", c: [[1, "Decimal", "Period"], [[para(str("one")), {t: "BulletList", c: [[para(str("sub"))]]}], [para(str("two"))]]]});
    const table = doc.blocks[1];
    expect(table?.t === "Table" && table.c[4][0]?.[3].length).toBe(2);
  });
  it("reads supported pictures in a shape-picture destination", async () => {
    expect((await read(String.raw`{\rtf1{\*\shppict{\pict\pngblip 89504e470d0a1a0a}}}`)).resources).toHaveLength(1);
  });
  it.each([String.raw`{\rtf1{\*\unknown visible}}`, String.raw`{\rtf1{\*\header visible}}`, String.raw`{\rtf1{\field hidden{\*\fldinst HYPERLINK "https://example.test"}{\fldrslt label}}}`])("rejects unsupported text-bearing destinations and extra field text: %s", async source => {
    await expect(read(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
  });
  it("preserves outline headings and scoped paragraph alignment/indents", async () => {
    const doc = await read(String.raw`{\rtf1\outlinelevel0 Title\par\pard{\qc\li720\ri360\fi-240 centered\par}normal}`);
    expect(doc.blocks).toEqual([{t: "Header", c: [1, attr, [str("Title")]]}, {t: "Div", c: [["", [], [["text-align", "center"], ["margin-left", "36pt"], ["margin-right", "18pt"], ["text-indent", "-12pt"]]], [para(str("centered"))]]}, para(str("normal"))]);
  });
  it("preserves footnotes as typed notes with scoped formatting", async () => {
    const doc = await read(String.raw`{\rtf1 A{\footnote\pard{\b note}\par second}B}`);
    expect(doc.blocks).toEqual([para(str("A"), {t: "Note", c: [para({t: "Strong", c: [str("note")]}), para(str("second"))]}, str("B"))]);
  });
  it.each([String.raw`{\rtf1\ansicpg1251 x}`, String.raw`{\rtf1\ansicpg932 x}`, String.raw`{\rtf1\ansicpg28591 x}`, String.raw`{\rtf1\mac x}`, String.raw`{\rtf1{\fonttbl{\f0\fcharset204 Cyrillic;}}x}`])("rejects encodings outside the pinned profile: %s", async source => {
    await expect(read(source)).rejects.toMatchObject({code: "E_ENCODING"});
  });
  it("retains PNG hex and JPEG binary without parsing their bytes as controls", async () => {
    const png = await read(String.raw`{\rtf1 A{\pict\pngblip\picw1\pich1 89504e470d0a1a0a}B}`);
    expect(png.resources[0]?.bytes).toEqual(Uint8Array.of(137,80,78,71,13,10,26,10));
    expect(png.blocks[0]).toEqual(para(str("A"), {t: "Image", c: [attr, [], ["rtf-picture-1.png", ""]]}, str("B")));
    const jpeg = await read("{\\rtf1{\\pict\\jpegblip\\bin6 " + String.fromCharCode(255,216,123,125,255,217) + "}}");
    expect(jpeg.resources[0]?.bytes).toEqual(Uint8Array.of(255,216,123,125,255,217));
  });
  it.each([
    [String.raw`{\rtf1\'z0}`, "E_PARSE"], [String.raw`{\rtf1\'0}`, "E_PARSE"],
    [String.raw`{\rtf1{\*\ignored\bin10 x}}`, "E_PARSE"], [String.raw`{\rtf1\bin-1 x}`, "E_PARSE"],
    [String.raw`{\rtf1`, "E_PARSE"], [String.raw`{\rtf2 text}`, "E_CAPABILITY"],
    [String.raw`{\rtf1\ansicpg437 text}`, "E_ENCODING"], [String.raw`{\rtf1\ansicpg99999 text}`, "E_ENCODING"],
    [String.raw`{\rtf1\u-10179?}`, "E_ENCODING"], [String.raw`{\rtf1\u-8704?}`, "E_ENCODING"],
    [String.raw`{\rtf1\uc-1 x}`, "E_PARSE"], [String.raw`{\rtf1\unknown visible}`, "E_CAPABILITY"],
    [String.raw`{\rtf1{\object{\objdata 00}{\result visible}}}`, "E_CAPABILITY"],
    [String.raw`{\rtf1{\*\object hidden}}`, "E_CAPABILITY"],
    [String.raw`{\rtf1{\pict\wmetafile8 00}}`, "E_CAPABILITY"],
    [String.raw`{\rtf1{\pict\pngblip 0}}`, "E_PARSE"],
    [String.raw`{\rtf1\trowd\cellx1000\intbl x\row}`, "E_PARSE"]
  ])("fails strictly for malformed or unsupported input: %s", async (source, code) => {
    await expect(read(source)).rejects.toMatchObject({code});
  });
  it("bounds nesting, parser work, picture bytes and image count", async () => {
    await expect(read("{\\rtf1 " + "{".repeat(20) + "x" + "}".repeat(20) + "}", {limits: {depth: 10}})).rejects.toMatchObject({code: "E_LIMIT"});
    await expect(read(String.raw`{\rtf1{\pict\pngblip 89504e470d0a1a0a}}`, {limits: {binaryBytes: 7}})).rejects.toMatchObject({code: "E_LIMIT"});
    await expect(read(String.raw`{\rtf1{\pict\pngblip 89504e470d0a1a0a}}`, {limits: {images: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
    await expect(read(String.raw`{\rtf1 text}`, {limits: {work: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
  });
  it("accepts paragraph resets within cells and preserves multiple cell paragraphs", async () => {
    const doc = await read(String.raw`{\rtf1\trowd\cellx1000\pard\intbl first\par second\cell\row\pard after}`);
    const table = doc.blocks[0];
    expect(table?.t === "Table" && table.c[4][0]?.[3][0]?.[1][0]?.[4]).toEqual([para(str("first")), para(str("second"))]);
    expect(doc.blocks[1]).toEqual(para(str("after")));
  });
  it("preserves the default font's family as attributed run data", async () => {
    expect((await read(String.raw`{\rtf1\deff0{\fonttbl{\f0\fnil Serif;}}text}`)).blocks).toEqual([para({t: "Span", c: [["", [], [["font-family", "Serif"]]], [str("text")]]})]);
  });
  it("retains style inheritance including outline levels and detects cycles", async () => {
    const doc = await read(String.raw`{\rtf1{\stylesheet{\s0\b Base;}{\s1\sbasedon0\i\outlinelevel1 Heading;}}\s1 title}`);
    expect(doc.blocks).toEqual([{t: "Header", c: [2, attr, [{t: "Strong", c: [{t: "Emph", c: [str("title")]}]}]]}]);
    await expect(read(String.raw`{\rtf1{\stylesheet{\s1\sbasedon2 A;}{\s2\sbasedon1 B;}}\s1 title}`)).rejects.toMatchObject({code: "E_PARSE"});
  });
  it("decodes identical UTF-8 byte input at every producer chunk boundary", async () => {
    const raw = bytes("{\\rtf1\\ansicpg65001 " + String.fromCharCode(0xc3,0xa9,0xf0,0x9f,0x98,0x80) + "}");
    const expected = await readDocument({bytes: raw}, {from: "rtf"}, {});
    for (let i = 0; i <= raw.length; i++) expect(await readDocument({chunks: [raw.subarray(0,i), raw.subarray(i)]}, {from: "rtf"}, {})).toEqual(expected);
    await expect(read(String.raw`{\rtf1\ansicpg65001\'c3}`)).rejects.toMatchObject({code: "E_ENCODING"});
    await expect(read(String.raw`{\rtf1\ansicpg65001\'ff}`)).rejects.toMatchObject({code: "E_ENCODING"});
  });
  it("counts control words, escaped symbols and binary blocks as fallback units", async () => {
    expect((await read(String.raw`{\rtf1\uc3\u945\tab\~\bin4 {}\\X}`)).blocks).toEqual([para(str("αX"))]);
    expect((await read(String.raw`{\rtf1\uc0\u945?}`)).blocks).toEqual([para(str("α?"))]);
  });
  it.each([String.raw`{\rtf1\u32768?}`, String.raw`{\rtf1\uc2147483648 x}`, String.raw`{\rtf1\u-?}`, String.raw`{\rtf1\bin x}`, String.raw`{\rtf1\'gg}`, String.raw`{\rtf1}extra`])("rejects invalid parameters and trailing input: %s", async source => {
    await expect(read(source)).rejects.toMatchObject({code: "E_PARSE"});
  });
  it("rejects unsupported table merges and picture encodings without projecting text", async () => {
    await expect(read(String.raw`{\rtf1\trowd\clmgf\cellx1000\intbl visible\cell\row}`)).rejects.toMatchObject({code: "E_CAPABILITY"});
    await expect(read(String.raw`{\rtf1{\pict\dibitmap0 0000}}`)).rejects.toMatchObject({code: "E_CAPABILITY"});
    await expect(read(String.raw`{\rtf1{\pict\pngblip\picw100000\pich100000 89504e470d0a1a0a}}`)).rejects.toMatchObject({code: "E_LIMIT"});
  });
  it.each([String.raw`{\rtf1{\fonttbl{\f0\fnil{\*\fontemb\bin1 x}Serif;}}visible}`, String.raw`{\rtf1{\fonttbl{\f0\unsupported Serif;}}visible}`])("rejects embedded fonts and unknown font controls: %s", async source => {
    await expect(read(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
  });
  it.each([
    String.raw`{\rtf1{\stylesheet{\s1{\*\unknown visible}Style;}}\s1 body}`,
    String.raw`{\rtf1{\*\listtable{\list{\listlevel\levelnfc0\unknown visible}\listid7}}body}`,
    String.raw`{\rtf1{\*\listoverridetable{\listoverride\listid7\listoverridecount0\unknown visible\ls2}}body}`
  ])("rejects unknown constructs inside style and list definitions: %s", async source => {
    await expect(read(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
  });
  it("converts memfs operands through the existing thin command and reports strict failures", async () => {
    const volume = Volume.fromJSON({"/in.rtf": String.raw`{\rtf1\b hello}`});
    const stdout = {write: vi.fn(async (_value: Uint8Array) => {})};
    const stderr = {write: vi.fn(async (_value: Uint8Array) => {})};
    const ctx = {args: ["-f", "rtf", "-t", "html", "/in.rtf", "-o", "/out.html"], stdin: [], signal: new AbortController().signal, stdout, stderr,
      readFile: async (path: string) => new Uint8Array(volume.readFileSync(path) as Uint8Array),
      writeFile: async (path: string, data: Uint8Array) => {volume.writeFileSync(path, data);}};
    expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
    expect(volume.readFileSync("/out.html", "utf8")).toBe("<p><strong>hello</strong></p>\n");
    volume.writeFileSync("/in.rtf", String.raw`{\rtf1\unknown text}`);
    expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 2});
    expect(new TextDecoder().decode(stderr.write.mock.calls[0]?.[0])).toContain("E_CAPABILITY:");
  });
});
