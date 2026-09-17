import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { convert, readDocument } from "./engine.js";
import type { ConversionContext } from "./types.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const read = (s: string, context: ConversionContext = {}) => readDocument({bytes: bytes(s), source: "/book/main.tex", base: "/book"}, {from: "latex"}, context);
const json = (s: string, policy = {}, context: ConversionContext = {}) => convert([{bytes: bytes(s)}], {from: "latex", to: "json", ...policy}, context);
const str = (c: string) => ({t: "Str", c});
it("parses escaped braces, comments, whitespace and nested emphasis groups", async () => {
  expect((await read("a\\{b\\} % hidden\n c\n\n\\emph{one {two} \\textbf{three}}" )).blocks).toEqual([
    {t: "Para", c: [str("a{b}"), {t: "Space"}, str("c")]},
    {t: "Para", c: [{t: "Emph", c: [str("one"), {t: "Space"}, str("two"), {t: "Space"}, {t: "Strong", c: [str("three")]}]}]}
  ]);
});
it("maps document metadata, starred sections, optional titles, labels and forward references", async () => {
  const doc = await read("\\documentclass[11pt]{article}\\title{Original}\\begin{document}\\ref{sec:a}\\section*[Short]{Long}\\label{sec:a}Body\\end{document}");
  expect(doc.metadata.title).toEqual({t: "MetaInlines", c: [str("Original")]});
  expect(doc.blocks).toEqual([
    {t: "Para", c: [{t: "Link", c: [["", [], []], [str("Long")], ["#sec:a", ""]]}]},
    {t: "Header", c: [1, ["sec:a", ["unnumbered"], [["short-title", "Short"]]], [str("Long")]]},
    {t: "Para", c: [str("Body")]}
  ]);
});
it("maps nested lists, quotes, links and exact verbatim terminators", async () => {
  const doc = await read("\\begin{itemize}\\item A\\begin{enumerate}\\item B\\end{enumerate}\\item C\\end{itemize}\\begin{quote}\\href{https://example.test/a}{go}\\end{quote}\\begin{verbatim}\n% { $ \\end{verbat} x\n\\end{verbatim}\\verb|a{b}%|");
  expect(doc.blocks.map(b => b.t)).toEqual(["BulletList", "BlockQuote", "CodeBlock", "Para"]);
  expect(doc.blocks[2]).toEqual({t: "CodeBlock", c: [["", [], []], "% { $ \\end{verbat} x\n"]});
  expect(doc.blocks[3]).toEqual({t: "Para", c: [{t: "Code", c: [["", [], []], "a{b}%"]}]});
});
it("retains typed inline and display math source and escaped dollars", async () => {
  expect((await read("\\$ $x_{1}+\\alpha$ $$y$$ \\(z\\) \\[w\\]\\begin{equation}q\\end{equation}")).blocks).toEqual([{t: "Para", c: [str("$"), {t: "Space"}, {t: "Math", c: ["InlineMath", "x_{1}+\\alpha"]}, {t: "Space"}, {t: "Math", c: ["DisplayMath", "y"]}, {t: "Space"}, {t: "Math", c: ["InlineMath", "z"]}, {t: "Space"}, {t: "Math", c: ["DisplayMath", "w"]}, {t: "Math", c: ["DisplayMath", "q"]}]}]);
});
it("maps figures and multicolumn tables with alignment and caption", async () => {
  const doc = await read("\\begin{figure}[ht]\\includegraphics[width=3cm]{plot.png}\\caption{Plot}\\label{fig:p}\\end{figure}\\begin{table}\\caption{Grid}\\begin{tabular}{lc}a & b \\\\ \\multicolumn{2}{c}{wide} \\\\\\end{tabular}\\end{table}");
  expect(doc.blocks[0]?.t).toBe("Figure");
  const table = doc.blocks[1];
  expect(table?.t).toBe("Table");
  if (table?.t !== "Table") throw new Error("Expected table");
  expect(table.c[2].map(c => c[0])).toEqual(["AlignLeft", "AlignCenter"]);
  expect(table.c[4][0]?.[3][1]?.[1][0]?.slice(1, 4)).toEqual(["AlignCenter", 1, 2]);
});
it("expands bounded simple macros, optional defaults and Unicode commands", async () => {
  expect((await read("\\newcommand{\\greet}[2][Hi]{#1 \\emph{#2}}\\greet{Zo\\'e} \\greet[Yo]{\\ae} \\LaTeX \\textendash")).blocks).toEqual([{t: "Para", c: [str("Hi"), {t: "Space"}, {t: "Emph", c: [str("Zoé")]}, {t: "Space"}, str("Yo"), {t: "Space"}, {t: "Emph", c: [str("æ")]}, {t: "Space"}, str("LaTeX"), {t: "Space"}, str("–")]}]);
});
describe("malformed and forbidden input", () => {
  for (const source of ["{oops", "oops}", "\\emph", "$oops", "$$oops$", "\\(x\\]", "\\begin{quote}x\\end{itemize}", "\\begin{quote}", "\\verb|oops", "\\begin{verbatim}oops", "\\section[short{title}", "\\newcommand{\\x}[1]{#2}\\x{a}"]) {
    it(`rejects malformed EOF/delimiters: ${source}`, async () => {await expect(read(source)).rejects.toMatchObject({code: "E_PARSE"});});
  }
  for (const command of ["catcode", "write", "write18", "directlua", "def", "gdef", "csname", "usepackage", "openout", "read", "special"]) {
    it(`never accepts forbidden primitive ${command}, including lossy`, async () => {
      for (const policy of [{}, {rawContent: "retain"}, {lossy: true}]) await expect(json(`\\${command}{payload}`, policy)).rejects.toMatchObject({code: "E_CAPABILITY"});
    });
  }
});
it("rejects recursion, undefined macros and excessive expansion", async () => {
  await expect(read("\\newcommand{\\x}{\\x}\\x")).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read("\\unknown[option]{one}{two}")).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(read("\\newcommand{\\x}{abc}\\x\\x", {limits: {macros: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("preserves the complete unknown command and arguments under explicit loss policy", async () => {
  for (const policy of [{rawContent: "retain"}, {rawContent: "escape"}, {lossy: true}]) {
    const result = await json("before \\unknown[opt]{a {b}}{c} after", policy);
    expect(result.kind === "text" && JSON.parse(result.text).blocks[0].c).toContainEqual({t: "RawInline", c: ["latex", "\\unknown[opt]{a {b}}{c}"]});
    expect(result.diagnostics.map(d => d.code)).toContain("W_RAW_CONTENT");
  }
});
it("resolves nested includes only through injected memfs resources before output", async () => {
  const fs = Volume.fromJSON({"/book/chapter.tex": "\\input{part}", "/book/part.tex": "Included"});
  const resolve = vi.fn(async (id: string, base: string | undefined) => bytes(fs.readFileSync(`${base}/${id}`, "utf8") as string));
  expect((await read("\\input{chapter}", {resources: {resolve}})).blocks).toEqual([{t: "Para", c: [str("Included")]}]);
  expect(resolve.mock.calls.map(c => c[0])).toEqual(["chapter.tex", "part.tex"]);
  await expect(read("\\input{missing}", {resources: {resolve}})).rejects.toMatchObject({code: "E_IO"});
  await expect(read("\\input{chapter}")).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("rejects include cycles, traversal, depth and byte excess before publication", async () => {
  const resolve = vi.fn(async () => bytes("\\input{loop}"));
  await expect(read("\\input{loop}", {resources: {resolve}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read("\\input{../escape}", {resources: {resolve}})).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(read("\\input{loop}", {resources: {resolve}, limits: {includes: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read("\\input{loop}", {resources: {resolve: async () => bytes("too big")}, limits: {resourceBytes: 2}})).rejects.toMatchObject({code: "E_LIMIT"});
  const publish = vi.fn(async () => {});
  await expect(json("\\input{missing}", {}, {resources: {resolve: async () => {throw new Error("missing");}}, output: {publish}})).rejects.toMatchObject({code: "E_IO"});
  expect(publish).not.toHaveBeenCalled();
});
it("keeps group-local macro definitions local and supports renewal/provision", async () => {
  expect((await read("\\newcommand{\\x}{A}{\\renewcommand{\\x}{B}\\x}\\providecommand{\\x}{C}\\x")).blocks).toEqual([{t: "Para", c: [str("BA")]}]);
  await expect(read("{\\newcommand{\\local}{x}}\\local")).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(read("\\newcommand{\\section}{bad}")).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("rejects replacing supported Unicode, accent and line-break commands under every loss policy", async () => {
  for (const name of ["dots", "pounds", "euro", "textless", "textgreater", "c", "v", "u", "H", "r", "newline"]) {
    for (const definition of ["newcommand", "renewcommand", "providecommand"]) {
      for (const policy of [{}, {rawContent: "retain"}, {lossy: true}]) {
        await expect(json(`\\${definition}{\\${name}}{replacement}`, policy)).rejects.toMatchObject({code: "E_CAPABILITY"});
      }
    }
  }
});
it("supports nested optional argument groups and escaped math dollars", async () => {
  const doc = await read("\\section[{a]b}]{Title}$\\$x$\\'e!");
  expect(doc.blocks[0]?.t === "Header" && doc.blocks[0].c[1][2]).toEqual([["short-title", "{a]b}"]]);
  expect(doc.blocks[1]).toEqual({t: "Para", c: [{t: "Math", c: ["InlineMath", "\\$x"]}, str("é!")]});
});
it("preserves unknown environments whole, including command arguments and comments", async () => {
  const source = "\\begin{custom}[opt]\\mystery{a}% c\n\\end{custom}";
  const result = await json(source, {lossy: true});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "RawBlock", c: ["latex", source]}]);
  expect(result.diagnostics).toHaveLength(1);
});
it("does not treat unknown verbatim-prefixed environments as verbatim", async () => {
  const source = "\\begin{verbatimcustom}one \\mystery[opt]{two} three\\end{verbatimcustom}";
  await expect(json(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
  for (const policy of [{rawContent: "retain"}, {lossy: true}]) {
    const result = await json(source, policy);
    expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "RawBlock", c: ["latex", source]}]);
    expect(result.diagnostics.map(d => d.code)).toEqual(["W_RAW_CONTENT"]);
    const expanded = await json("\\newcommand{\\wrap}[1]{\\begin{verbatimcustom}#1\\end{verbatimcustom}}\\wrap{payload}", policy);
    expect(expanded.kind === "text" && JSON.parse(expanded.text).blocks).toEqual([{t: "RawBlock", c: ["latex", "\\begin{verbatimcustom}payload\\end{verbatimcustom}"]}]);
  }
});
it("rejects invalid table geometry and unresolved/duplicate labels", async () => {
  for (const source of ["\\begin{tabular}{lc}a\\end{tabular}", "\\begin{tabular}{l}\\multicolumn{2}{c}{x}\\end{tabular}", "\\section{A}\\label{x}\\section{B}\\label{x}"]) {
    await expect(read(source)).rejects.toMatchObject({code: "E_PARSE"});
  }
  await expect(read("\\ref{missing}")).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("bounds nested groups, expansion bytes and exact aggregate include bytes", async () => {
  await expect(read("{{{{x}}}}", {limits: {depth: 2}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read("\\newcommand{\\x}{abcd}\\x", {limits: {expandedBytes: 2}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect((await read("\\include{one}", {resources: {resolve: async () => bytes("ok")}, limits: {resourceBytes: 2}})).blocks).toEqual([{t: "Para", c: [str("ok")]}]);
});
it("preserves argument-adjacent comments and starred unknown commands whole", async () => {
  const source = "\\unknown*%comment\n[opt]{arg}";
  const result = await json(source, {lossy: true});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "Para", c: [{t: "RawInline", c: ["latex", source]}]}]);
});
it("preserves significant whitespace inside nested groups", async () => {
  expect((await read("a{ b }c")).blocks).toEqual([{t: "Para", c: [str("a"), {t: "Space"}, str("b"), {t: "Space"}, str("c")]}]);
});
it("does not treat comment parameter markers as macro parameters", async () => {
  expect((await read("\\newcommand{\\x}{a%# nonsense\nb}\\x")).blocks).toEqual([{t: "Para", c: [str("ab")]}]);
});
it("preserves macro parameter and comment control-word boundaries", async () => {
  expect((await read("\\newcommand{\\suffix}[1]{#1x}\\suffix{\\ae}")).blocks).toEqual([{t: "Para", c: [str("æx")]}]);
  expect((await read("\\newcommand{\\joined}{\\ae% boundary\nx}\\joined")).blocks).toEqual([{t: "Para", c: [str("æx")]}]);
  expect((await read("\\newcommand{\\format}[1]{\\emph{#1x}}\\format{\\oe}")).blocks).toEqual([{t: "Para", c: [{t: "Emph", c: [str("œx")]}]}]);
  for (const policy of [{}, {rawContent: "retain"}, {lossy: true}]) {
    for (const source of ["\\newcommand{\\suffix}[1]{#1x}\\suffix{\\ae}", "\\newcommand{\\joined}{\\ae% boundary\nx}\\joined"]) {
      const result = await json(source, policy);
      expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "Para", c: [str("æx")]}]);
    }
  }
});
it("does not substitute parameter markers inside macro verbatim regions", async () => {
  expect((await read("\\newcommand{\\literal}{\\verb|#1|}\\literal")).blocks).toEqual([{t: "Para", c: [{t: "Code", c: [["", [], []], "#1"]}]}]);
  for (const policy of [{}, {rawContent: "retain"}, {lossy: true}]) {
    const result = await json("\\newcommand{\\literal}{\\verb|#1|}\\literal", policy);
    expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "Para", c: [{t: "Code", c: [["", [], []], "#1"]}]}]);
  }
});
it("preserves expanded token boundaries when an unsupported environment is retained raw", async () => {
  const source = "\\newcommand{\\wrap}[1]{\\begin{custom}#1x\\end{custom}}\\wrap{\\ae}";
  await expect(json(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
  for (const policy of [{rawContent: "retain"}, {lossy: true}]) {
    const result = await json(source, policy);
    expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "RawBlock", c: ["latex", "\\begin{custom}\\ae{}x\\end{custom}"]}]);
    expect(result.diagnostics.map(d => d.code)).toEqual(["W_RAW_CONTENT"]);
  }
});
it("validates interpolated math source against forbidden primitives under every policy", async () => {
  for (const policy of [{}, {rawContent: "retain"}, {lossy: true}]) {
    await expect(json("\\newcommand{\\mathsource}[1]{$\\wr#1$}\\mathsource{ite18{x}}", policy)).rejects.toMatchObject({code: "E_CAPABILITY"});
  }
});
it("rejects repeated captions instead of deleting their arguments", async () => {
  await expect(read("\\begin{figure}\\caption{one}\\caption{two}\\end{figure}")).rejects.toMatchObject({code: "E_PARSE"});
});
it("decodes escaped characters in braced link targets", async () => {
  expect((await read("\\href{https://example.test/a\\%20b}{go}\\url{https://example.test/\\#fragment}")).blocks).toEqual([{t: "Para", c: [
    {t: "Link", c: [["", [], []], [str("go")], ["https://example.test/a%20b", ""]]},
    {t: "Link", c: [["", [], []], [str("https://example.test/#fragment")], ["https://example.test/#fragment", ""]]}
  ]}]);
});
it("rejects cyclic reference titles without constructing a cyclic AST", async () => {
  await expect(read("\\section{\\ref{x}}\\label{x}")).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("rejects empty tabular and forbidden commands inside math and macro bodies", async () => {
  await expect(read("\\begin{tabular}{l}\\end{tabular}")).rejects.toMatchObject({code: "E_PARSE"});
  for (const source of ["$\\catcode{x}$", "\\newcommand{\\x}{\\write18{x}}", "\\begin{quote}\\directlua{x}\\end{quote}"]) {
    await expect(json(source, {lossy: true})).rejects.toMatchObject({code: "E_CAPABILITY"});
  }
});
it("retains table column/rule source attributes inside a float", async () => {
  const table = (await read("\\begin{table}\\begin{tabular}{|l|}\\hline x\\\\\\end{tabular}\\end{table}")).blocks[0];
  expect(table?.t === "Table" && table.c[0][2]).toEqual([["latex-column-spec", "|l|"], ["latex-hlines", "1"]]);
});
it("bounds include depth and propagates cancellation before publication", async () => {
  const resolve = vi.fn(async (id: string) => bytes(`\\input{${id === "one.tex" ? "two" : "three"}}`));
  await expect(read("\\input{one}", {resources: {resolve}, limits: {depth: 2}})).rejects.toMatchObject({code: "E_LIMIT"});
  const controller = new AbortController();
  const publish = vi.fn(async () => {});
  await expect(json("\\input{one}", {}, {signal: controller.signal, resources: {resolve: async () => {controller.abort(); return bytes("late");}}, output: {publish}})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(publish).not.toHaveBeenCalled();
});
