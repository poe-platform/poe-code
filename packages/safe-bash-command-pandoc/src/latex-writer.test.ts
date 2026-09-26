import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { writeDocument } from "./engine.js";
import { createPandocCommand } from "./safe-bash.js";
import type { Attr, Block, Cell, Inline, Row } from "./ast-types.js";
import type { WriteOptions } from "./types.js";

const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
async function latex(blocks: readonly Block[], options: Partial<WriteOptions> = {}) {
  return writeDocument({blocks, metadata: {}, resources: []}, {to: "latex", ...options}, {});
}
it("escapes special characters and keeps adjacent formatting grouped", async () => {
  expect(await latex([p(s("#$%&_{}~^\\"), {t: "Emph", c: [s("a")]}, {t: "Emph", c: [s("b")]},
    {t: "Strong", c: [{t: "Underline", c: [s("c")]}]}, {t: "Strikeout", c: [s("d")]} )])).toMatchObject({
    text: "\\#\\$\\%\\&\\_\\{\\}\\textasciitilde{}\\textasciicircum{}\\textbackslash{}\\emph{a}\\emph{b}\\textbf{\\uline{c}}\\sout{d}\n", diagnostics: []});
});
it("handles all code delimiters and environment terminators as literal escaped code", async () => {
  const source = "|!+{}%\\end{verbatim}\n  next";
  const result = await latex([p({t: "Code", c: [a, source]}), {t: "CodeBlock", c: [a, source]}]);
  expect(result).toMatchObject({kind: "text", diagnostics: []});
  if(result.kind !== "text") throw new Error("text expected");
  expect(result.text).not.toContain("\\verb");
  expect(result.text).toContain('\\char"5C{}end\\char"7B{}verbatim\\char"7D{}');
  expect(result.text).toContain("\\mbox{\\ \\ next}");
});
it("maps five article heading levels and uses deterministic safe labels and forward references", async () => {
  const blocks: Block[] = [p({t: "Link", c: [a, [s("go")], ["#a_%", ""]]}),
    ...[1, 2, 3, 4, 5].map((level): Block => ({t: "Header", c: [level, [level === 1 ? "a_%" : "", [], []], [s("Heading")]]}))];
  const result = await latex(blocks);
  expect(result).toMatchObject({text: expect.stringContaining("\\hyperref[pc-61-5f-25]{go}")});
  for(const command of ["section", "subsection", "subsubsection", "paragraph", "subparagraph"]) expect(result).toMatchObject({text: expect.stringContaining(`\\${command}{Heading}`)});
  await expect(latex([{t: "Header", c: [6, a, [s("deep")]]}])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await latex([{t: "Header", c: [6, a, [s("deep")]]}], {lossy: true})).toMatchObject({diagnostics: [expect.objectContaining({location: "$.blocks[0]"})]});
  expect(await latex(blocks)).toEqual(result);
});
it("defers nested note text with explicit numbering instead of nesting footnote bodies", async () => {
  expect(await latex([p(s("text"), {t: "Note", c: [p(s("outer"), {t: "Note", c: [p(s("inner"))]})]})])).toMatchObject({
    text: "text\\protect\\footnotemark[1]\n\n\\footnotetext[1]{outer\\protect\\footnotemark[2]\n\n}\n\\footnotetext[2]{inner\n\n}\n"});
});
it("writes nested lists, definitions, lines, quotes and figures", async () => {
  const result = await latex([{t: "OrderedList", c: [[4, "LowerRoman", "TwoParens"], [[p(s("item")), {t: "BulletList", c: [[p(s("nested"))]]}]]]},
    {t: "DefinitionList", c: [[[s("term ] %")], [[p(s("meaning"))]]]]}, {t: "LineBlock", c: [[s("one")], [s("two")]]},
    {t: "BlockQuote", c: [p(s("quote"))]}, {t: "Figure", c: [a, [null, [p(s("caption"))]], [p(s("figure"))]]}]);
  expect(result).toMatchObject({text: expect.stringContaining("\\begin{enumerate}[start=4,label=(\\roman*)]")});
  expect(result).toMatchObject({text: expect.stringContaining("\\item[{term ] \\%}]")});
  expect(result).toMatchObject({text: expect.stringContaining("\\caption{caption")});
});
it("preserves typed math but rejects executable raw content and math breakouts before publication", async () => {
  expect(await latex([p({t: "Math", c: ["InlineMath", "x_{1}+\\alpha"]}, {t: "Math", c: ["DisplayMath", "\\frac{a}{b}"]})])).toMatchObject({text: "\\(x_{1}+\\alpha\\)\\[\\frac{a}{b}\\]\n"});
  const publish = vi.fn(async () => {});
  for(const node of [{t: "RawBlock", c: ["latex", "\\input{secret}"]}, {t: "Para", c: [{t: "Math", c: ["InlineMath", "x\\)\\input{secret}\\(y"]}]}] as Block[]) {
    await expect(writeDocument({blocks: [node], metadata: {}, resources: []}, {to: "latex"}, {output: {publish}})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  }
  expect(publish).not.toHaveBeenCalled();
  await expect(latex([{t: "RawBlock", c: ["latex", "\\write18{x}"]}], {rawContent: "retain"})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("uses context-specific image and URL escaping and rejects unsafe paths", async () => {
  expect(await latex([p({t: "Image", c: [a, [s("alt")], ["images/a b_1.png", ""]]}, {t: "Link", c: [a, [s("web")], ["https://example.test/a?q=1&b=2#x", ""]]})])).toMatchObject({text: expect.stringContaining("\\includegraphics{\\detokenize{images/a b_1.png}}")});
  expect(await latex([p({t: "Link", c: [a, [s("web")], ["https://example.test/a%20b#x", ""]]})])).toMatchObject({text: expect.stringContaining("a\\%20b\\#x")});
  for(const path of ["x}\\input{secret}", "a%20.png", "../secret.png", "|command", "https://host/a.png"]) await expect(latex([p({t: "Image", c: [a, [], [path, ""]]})])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
function table(rows: readonly Row[], head: readonly Row[] = []): Block {
  return {t: "Table", c: [a, [[s("Caption")], []], [["AlignLeft", {t: "ColWidth", c: 0.5}], ["AlignRight", {t: "ColWidthDefault"}]], [a, head], [[a, 0, [], rows]], [a, []]]};
}
const cell = (text: string, rs = 1, cs = 1): Cell => [a, "AlignDefault", rs, cs, [p(s(text))]];
it("writes longtable headers and spans with complete row slots", async () => {
  const result = await latex([table([[a, [cell("span", 2), cell("right")]], [a, [cell("next")]], [a, [cell("wide", 1, 2)]]], [[a, [cell("H1"), cell("H2")]]])]);
  expect(result).toMatchObject({text: expect.stringContaining("\\begin{longtable}")});
  expect(result).toMatchObject({text: expect.stringContaining("\\endfirsthead")});
  expect(result).toMatchObject({text: expect.stringContaining("\\multirow{2}{=}{span")});
  expect(result).toMatchObject({text: expect.stringContaining(" & next")});
  expect(result).toMatchObject({text: expect.stringContaining("\\multicolumn{2}")});
  const long = await latex([table(Array.from({length: 120}, (_, i) => [a, [cell(String(i)), cell("b")]]))]);
  expect(long).toMatchObject({text: expect.stringContaining("119")});
});
it("reports explicit loss for unsupported citations, attributes and nested tables", async () => {
  const blocks = [p({t: "Cite", c: [[{citationId: "x", citationPrefix: [], citationSuffix: [], citationMode: "NormalCitation", citationNoteNum: 0, citationHash: 0}], [s("citation")]]})];
  await expect(latex(blocks)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await latex(blocks, {lossy: true})).toMatchObject({diagnostics: [expect.objectContaining({message: expect.stringContaining("citation")})]});
  await expect(latex([p({t: "Span", c: [["", [], [["style", "x"]]], [s("x")]]})])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  const nested = table([[a, [[a, "AlignDefault", 1, 1, [table([[a, [cell("a"), cell("b")]]])]], cell("other")]]]);
  await expect(latex([nested])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await latex([nested], {lossy: true})).toMatchObject({diagnostics: [expect.objectContaining({message: expect.stringContaining("Nested table")})]});
});
it("uses a fixed standalone preamble, escaped metadata and finite language options", async () => {
  const result = await latex([p(s("body"))], {standalone: true, metadata: {title: {t: "MetaString", c: "A & B"}, lang: {t: "MetaString", c: "de-DE"}}});
  expect(result).toMatchObject({text: expect.stringContaining("\\documentclass{article}\n")});
  expect(result).toMatchObject({text: expect.stringContaining("\\usepackage[ngerman]{babel}")});
  expect(result).toMatchObject({text: expect.stringContaining("\\title{A \\& B}")});
  expect(result).toMatchObject({text: expect.stringContaining("\\end{document}\n")});
  await expect(latex([], {standalone: true, metadata: {lang: {t: "MetaString", c: "english]\\input{x}"}}})).rejects.toMatchObject({code: "E_OPTION"});
  await expect(latex([p(s("\0"))])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("publishes LaTeX via the thin adapter using only memfs and SDK options", async () => {
  const fs = Volume.fromJSON({"/out.tex": "original"});
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => {fs.writeFileSync(path, bytes);});
  const ctx = {args: ["-f=commonmark", "-t=latex", "-s", "-Mlang=en", "-o=/out.tex"], stdin: [new TextEncoder().encode("# Owned\n\n**bold**")],
    stdout: {write: vi.fn(async () => {})}, stderr: {write: vi.fn(async () => {})}, writeFile, signal: new AbortController().signal};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(fs.readFileSync("/out.tex", "utf8")).toContain("\\textbf{bold}");
  expect(writeFile).toHaveBeenCalledOnce();
});
it("rejects TeX superscript preprocessing in math and keeps note text near its owning block", async () => {
  await expect(latex([p({t: "Math", c: ["InlineMath", "^^5cinput{secret}"]})])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await latex([p(s("one"), {t: "Note", c: [p(s("note"))]}), p(s("two"))])).toMatchObject({
    text: "one\\protect\\footnotemark[1]\n\n\\footnotetext[1]{note\n\n}\ntwo\n"});
});
it("rejects table section/row attributes that would introduce alignment tokens outside cells", async () => {
  const block = table([[ ["row", [], []], [cell("one"), cell("two")] ]]);
  await expect(latex([block])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(await latex([block], {lossy: true})).toMatchObject({diagnostics: [expect.objectContaining({message: expect.stringContaining("table row")})]});
});
function structure(text: string): void {
  const environments: string[] = [];
  let groups = 0;
  for(let i = 0; i < text.length; i++) {
    if(text[i] === "\\") {
      let name = "";
      while(text[i + 1] && text[i + 1]! >= "a" && text[i + 1]! <= "z") name += text[++i];
      if(name === "begin" || name === "end") {
        expect(text[++i]).toBe("{"); let env = "";
        while(text[++i] && text[i] !== "}") env += text[i];
        if(name === "begin") environments.push(env); else expect(environments.pop()).toBe(env);
      } else if(!name) i++;
    } else if(text[i] === "{") groups++;
    else if(text[i] === "}") expect(--groups).toBeGreaterThanOrEqual(0);
  }
  expect(groups).toBe(0); expect(environments).toEqual([]);
}
it("emits balanced owned standalone structure and enforces output budgets/cancellation", async () => {
  const blocks = [{t: "Header", c: [1, a, [s("Owned")]]}, p({t: "Strong", c: [s("{}\\%")]}, {t: "Note", c: [p(s("note"))]}),
    table([[a, [cell("row", 2), cell("b")]], [a, [cell("c")]]]), {t: "CodeBlock", c: [a, "\\end{document}\n{}"]}] as Block[];
  const result = await latex(blocks, {standalone: true});
  if(result.kind !== "text") throw new Error("text expected"); structure(result.text);
  const document = {blocks, metadata: {}, resources: []}; const publish = vi.fn(async () => {});
  await expect(writeDocument(document, {to: "latex"}, {limits: {outputBytes: 8}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  const controller = new AbortController(); controller.abort();
  await expect(writeDocument(document, {to: "latex"}, {signal: controller.signal, output: {publish}})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(publish).not.toHaveBeenCalled();
});
it("honors explicit raw rejection in lossy mode", async () => {
  await expect(latex([{t: "RawBlock", c: ["latex", "\\unknown"]}], {lossy: true, rawContent: "reject"})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it.each([0, -1, 2])("rejects invalid column width %s", async width => {
    const block = table([[a, [cell("a"), cell("b")]]]);
    if(block.t !== "Table") throw new Error("table expected");
    const invalid: Block = {t: "Table", c: [block.c[0], block.c[1], [["AlignDefault", {t: "ColWidth", c: width}], block.c[2][1]!], block.c[3], block.c[4], block.c[5]]};
    await expect(latex([invalid])).rejects.toMatchObject({code: "E_AST"});
});
it("rejects floats inside notes", async () => {
  const figure: Block = {t: "Figure", c: [a, [null, []], [p(s("figure"))]]};
  await expect(latex([p({t: "Note", c: [figure]})])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("rejects nested floats", async () => {
  const figure: Block = {t: "Figure", c: [a, [null, []], [p(s("figure"))]]};
  await expect(latex([{t: "Figure", c: [a, [null, []], [figure]]}])).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("does not resolve forward links to row identifiers dropped by lossy projection", async () => {
  const result = await latex([p({t: "Link", c: [a, [s("row link")], ["#row", ""]]}), table([[ ["row", [], []], [cell("a"), cell("b")] ]])], {lossy: true});
  expect(result).toMatchObject({diagnostics: [expect.objectContaining({message: expect.stringContaining("Unresolved internal reference")}), expect.objectContaining({message: expect.stringContaining("table row")})]});
  if(result.kind !== "text") throw new Error("text expected"); expect(result.text).not.toContain("\\hyperref");
});
it("emits cell labels once even when table header text is repeated", async () => {
  const result = await latex([table([[a, [cell("a"), cell("b")]]], [[a, [[['h', [], []], 'AlignDefault', 1, 1, [p(s('H'))]], cell('B')]]])]);
  if(result.kind !== "text") throw new Error("text expected");
  expect(result.text.split("\\label{pc-68}").length).toBe(2);
});
it("scopes explicit fragment language to a deterministic babel environment", async () => {
  expect(await latex([p(s("Deutsch"))], {metadata: {lang: {t: "MetaString", c: "de"}}})).toMatchObject({
    text: "\\begin{otherlanguage}{ngerman}\nDeutsch\n\n\\end{otherlanguage}\n"});
});
