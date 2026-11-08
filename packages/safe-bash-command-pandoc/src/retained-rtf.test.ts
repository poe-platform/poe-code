import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Attr, Block, Inline, MetaValue} from "./ast-types.js";
const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
async function parity(blocks: readonly Block[], metadata: Readonly<Record<string, MetaValue>> = {}, lossy = false) {
  const wire = await writeDocument({blocks, metadata, resources: []}, {to: "json"}, {});
  if (wire.kind !== "text") throw new Error("Expected text");
  const input = {bytes: new TextEncoder().encode(wire.text)}, options = {from: "json", to: "rtf", lossy};
  const expected = await convert([input], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(), working = {fs, directory: "/", cacheBytes: 16384}; let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Collector forbidden"));
  let actual: unknown;
  try {
    const summary = await convertToOutput([input], options, {workingFiles: working, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    actual = {text, diagnostics: summary.diagnostics};
  } catch (error) {actual = error;} finally {expect(acquire).not.toHaveBeenCalled(); acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
  if (expected instanceof Error) expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message});
  else expect(actual).toMatchObject({text: expected.text, diagnostics: expected.diagnostics});
}
it("preserves text, attributes, sorted fonts and colors, and list definitions", async () => {
  const attr: Attr = ["", [], [["font-family", "Zeta"], ["color", "#Ff0000"], ["font-size", "0x10pt"], ["dir", "rtl"]]];
  await parity([{t: "Header", c: [2, a, [s("Header")]]}, p(s("{x}\\😀\r\nz"), {t: "Span", c: [attr, [{t: "Strong", c: [s("red")]}]]}),
    {t: "OrderedList", c: [[3, "UpperRoman", "TwoParens"], [[p(s("item")), {t: "BulletList", c: [[p(s("nested"))]]}], [p(s("second"))]]]},
    {t: "CodeBlock", c: [a, "code\n"]}, {t: "LineBlock", c: [[s("one")], []]}],
    {"rtf-fonts": {t: "MetaList", c: [{t: "MetaString", c: "Zeta"}, {t: "MetaString", c: "Alpha"}, {t: "MetaString", c: "Zeta"}]}});
});
it("preserves table widths, empty cells, captions and alignment", async () => {
  await parity([{t: "Table", c: [a, [null, [p(s("caption"))]], [["AlignLeft", {t: "ColWidth", c: 0.3}], ["AlignRight", {t: "ColWidthDefault"}]],
    [a, []], [[a, 0, [], [[a, [[a, "AlignDefault", 1, 1, []], [a, "AlignCenter", 1, 1, [p(s("cell"))]]]]]]], [a, []]]}]);
});
it("preserves strict and lossy diagnostics and supported hyperlinks", async () => {
  for (const lossy of [false, true]) await parity([{t: "Div", c: [["id", [], []], [p({t: "Link", c: [a, [s("go")], ["https://example.test?a=1", ""]]})]]}], {}, lossy);
  await parity([p({t: "Link", c: [a, [s("bad")], ["javascript:x", ""]]})]);
  await parity([p({t: "Span", c: [["", [], [["font-family", "Missing"]]], []]})]);
});

it("preserves empty nodes, notes, inline styling, quotations and definition lists", async () => {
  await parity([]);
  await parity([p(), {t: "Plain", c: []}, {t: "BlockQuote", c: [p(s("quote"))]}, {t: "HorizontalRule"},
    {t: "DefinitionList", c: [[[s("term")], [[p(s("definition"))], []]]]},
    p(...(["Emph", "Underline", "Strong", "Strikeout", "Superscript", "Subscript", "SmallCaps"] as const).map(t => ({t, c: [s(t)]})), {t: "Quoted", c: ["DoubleQuote", [s("quote")]]}, {t: "Note", c: [p(s("note")), p(s("second"))]})]);
  await parity([{t: "BulletList", c: [[], [p()], [p(s("[x] done"))]]}]);
});
it("retains font and color dictionaries larger than the cache", async () => {
  const names = Array.from({length: 100}, (_, i) => "Font" + (100-i));
  await parity(names.map((name, i) => p({t: "Span", c: [["", [], [["font-family", name], ["color", "#" + i.toString(16).padStart(6, "0")]]], [s(name)]]})), {"rtf-fonts": {t: "MetaList", c: names.map(c => ({t: "MetaString", c}))}});
});
it("preserves invalid font declarations, sizes, controls and projection failures", async () => {
  for (const name of ["", "A;B", "A\\B", "{font}", "A\nB"]) await parity([], {"rtf-fonts": {t: "MetaList", c: [{t: "MetaString", c: name}]}});
  for (const size of ["0pt", "1e9pt", "-1pt", "12px", "0.5pt", "1e1pt", "1" + "0".repeat(2000) + "e-2000pt"]) await parity([p({t: "Span", c: [["", [], [["font-size", size]]], [s("sized")]]})]);
  await parity([p(s("\0"))]);
  await parity([{t: "RawBlock", c: ["rtf", "raw"]}]);
});
