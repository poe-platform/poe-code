import { expect, it, vi } from "vitest";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { writeDocument, convert } from "./engine.js";
import type { Attr, Block, Cell, Inline, Row } from "./ast-types.js";
import type { Document, WriteOptions } from "./types.js";

const a: Attr = ["", [], []];
const s = (c: string): Inline => ({t: "Str", c});
const p = (...c: Inline[]): Block => ({t: "Para", c});
const doc = (blocks: readonly Block[]): Document => ({blocks, metadata: {}, resources: []});
async function html(blocks: readonly Block[], options: Record<string, unknown> = {}) {
  const result = await writeDocument(doc(blocks), {to: "html", ...options} as WriteOptions, {});
  if(result.kind !== "text") throw new Error("Expected text");
  return result.text;
}
function shape(node: DefaultTreeAdapterMap["node"]): unknown {
  if("value" in node) return node.value;
  return {tag: "tagName" in node ? node.tagName : "fragment",
    attrs: "attrs" in node ? node.attrs : [],
    children: "childNodes" in node ? node.childNodes.map(shape) : []};
}
function dom(actual: string, expected: string) {
  expect(shape(parseFragment(actual))).toEqual(shape(parseFragment(expected)));
}
it("writes nested formatting, quotes, citations, multilingual text and meaningful breaks", async () => {
  const blocks = [p({t: "Strong", c: [{t: "Emph", c: [s("你好 & <مرحبا>")]}]}, {t: "Space"},
    {t: "Underline", c: [s("u")]}, {t: "Strikeout", c: [s("d")]}, {t: "Superscript", c: [s("2")]},
    {t: "Subscript", c: [s("n")]}, {t: "SmallCaps", c: [s("Caps")]},
    {t: "Quoted", c: ["DoubleQuote", [s("q")]]}, {t: "SoftBreak"}, {t: "LineBreak"},
    {t: "Cite", c: [[], [s("citation")]]})];
  const expected = '<p><strong><em>你好 &amp; &lt;مرحبا&gt;</em></strong> <u>u</u><del>d</del><sup>2</sup><sub>n</sub><span class="smallcaps">Caps</span>“q”\n<br>citation</p>\n';
  const actual = await html(blocks); dom(actual, expected); expect(actual).toBe(expected);
});
it("preserves empty and code-only documents with text escaping separate from attribute escaping", async () => {
  expect(await html([])).toBe("");
  const expected = '<pre><code id="a&quot;&amp;" class="html">&lt;b x="y"&gt;&amp;\n  z\n</code></pre>\n';
  const actual = await html([{t: "CodeBlock", c: [[ 'a"&', ["html"], []], '<b x="y">&\n  z\n']}]);
  dom(actual, expected); expect(actual).toBe(expected);
});
it("preserves list starts and tightness, nested blocks, definitions, lines and figures", async () => {
  const actual = await html([{t: "OrderedList", c: [[4, "LowerRoman", "Period"], [[{t: "Plain", c: [s("tight")]}], [p(s("loose"))]]]},
    {t: "DefinitionList", c: [[[s("term")], [[p(s("definition"))]]]]},
    {t: "LineBlock", c: [[s("one")], [s(" two")]]},
    {t: "Figure", c: [a, [null, [p(s("caption"))]], [{t: "BlockQuote", c: [p(s("body"))]}]]}]);
  const expected = '<ol start="4" type="i">\n<li>tight</li>\n<li><p>loose</p>\n</li>\n</ol>\n<dl>\n<dt>term</dt>\n<dd><p>definition</p>\n</dd>\n</dl>\n<div class="line-block">one<br> two</div>\n<figure><blockquote><p>body</p>\n</blockquote>\n<figcaption><p>caption</p>\n</figcaption></figure>\n';
  dom(actual, expected); expect(actual).toBe(expected);
});
it("deduplicates heading IDs deterministically including already suffixed IDs", async () => {
  const actual = await html(["same", "same", "same-1", ""].map(id => ({t: "Header", c: [2, [id, [], []], [s("Same")]]})));
  expect(actual).toBe('<h2 id="same">Same</h2>\n<h2 id="same-2">Same</h2>\n<h2 id="same-1">Same</h2>\n<h2 id="same-3">Same</h2>\n');
});
it("escapes URLs, titles and image alt text independently without resolving resources", async () => {
  const resolve = vi.fn(async () => new Uint8Array());
  const result = await writeDocument(doc([p({t: "Link", c: [a, [s("link &")], ['https://example.test/a b?q="<&x=1', 't"<']]},
    {t: "Image", c: [a, [{t: "Emph", c: [s('alt "<&')]}], ["images/a b.png", "pic"]]})]), {to: "html5"}, {resources: {resolve}});
  const expected = '<p><a href="https://example.test/a%20b?q=%22%3C&amp;x=1" title="t&quot;&lt;">link &amp;</a><img src="images/a%20b.png" alt="alt &quot;&lt;&amp;" title="pic"></p>\n';
  expect(result).toMatchObject({text: expected, diagnostics: []}); dom(result.kind === "text" ? result.text : "", expected);
  expect(resolve).not.toHaveBeenCalled();
});
it("rejects active URI schemes, controls and active/reserved attributes before publication", async () => {
  const publish = vi.fn(async () => {});
  for(const url of ["javascript:alert(1)", "JaVaScRiPt:x", "data:text/html,x", "vbscript:x", "java\nscript:x", " https://a", "file:///a"]) {
    await expect(writeDocument(doc([p({t: "Link", c: [a, [s("x")], [url, ""]]})]), {to: "html5"}, {output: {publish}})).rejects.toMatchObject({code: "E_CAPABILITY"});
  }
  for(const key of ["onclick", "style", "href", "srcdoc", "xmlns", "ID"]) {
    await expect(html([p({t: "Span", c: [["", [], [[key, "javascript:x"]]], [s("x")]]})])).rejects.toMatchObject({code: "E_CAPABILITY"});
  }
  expect(publish).not.toHaveBeenCalled();
});
it("declares raw policy: reject by default, escape explicitly, retain HTML with warning", async () => {
  const blocks: Block[] = [{t: "RawBlock", c: ["html", '<script src="x">bad()</script>']}];
  await expect(html(blocks)).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(await html(blocks, {rawContent: "escape"})).toBe('&lt;script src="x"&gt;bad()&lt;/script&gt;\n');
  const result = await writeDocument(doc(blocks), {to: "html", rawContent: "retain"} as WriteOptions, {});
  expect(result).toMatchObject({text: '<script src="x">bad()</script>\n', diagnostics: [expect.objectContaining({code: "W_RAW_CONTENT", location: "$.blocks[0]"})]});
  await expect(html([{t: "RawBlock", c: ["latex", "\\x"]}], {rawContent: "retain"})).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("renders JSON notes with stable references and backlinks including nested notes", async () => {
  const blocks = [p(s("text"), {t: "Note", c: [p(s("note"), {t: "Note", c: [p(s("inner"))]})]})];
  const json = JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks});
  const result = await convert([{bytes: new TextEncoder().encode(json)}], {from: "json", to: "html"}, {});
  const expected = '<p>text<a href="#fn1" id="fnref1" class="footnote-ref" role="doc-noteref"><sup>1</sup></a></p>\n<section class="footnotes" role="doc-endnotes">\n<ol>\n<li id="fn1"><p>note<a href="#fn2" id="fnref2" class="footnote-ref" role="doc-noteref"><sup>2</sup></a></p>\n<a href="#fnref1" class="footnote-back" role="doc-backlink">↩</a></li>\n<li id="fn2"><p>inner</p>\n<a href="#fnref2" class="footnote-back" role="doc-backlink">↩</a></li>\n</ol>\n</section>\n';
  expect(result).toMatchObject({text: expected}); dom(result.kind === "text" ? result.text : "", expected);
});
it("writes the fixed standalone wrapper with escaped metadata and document settings", async () => {
  const result = await writeDocument({...doc([]), language: 'ar"', direction: "rtl", metadata: {title: {t: "MetaString", c: '<Title & "字"'}}}, {to: "html", standalone: true} as WriteOptions, {});
  expect(result).toMatchObject({text: '<!DOCTYPE html>\n<html lang="ar&quot;" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>&lt;Title &amp; "字"</title>\n</head>\n<body>\n</body>\n</html>\n'});
  expect(await html([], {standalone: true, metadata: {title: {t: "MetaString", c: "override"}, lang: {t: "MetaString", c: "日本語"}, dir: {t: "MetaString", c: "ltr"}}})).toContain('<html lang="日本語" dir="ltr">');
  for(const options of [{standalone: "yes"}, {template: "x"}, {rawContent: "unknown"}, {metadata: {dir: {t: "MetaString", c: "invalid"}}}]) await expect(html([], options)).rejects.toMatchObject({code: "E_OPTION"});
  await expect(writeDocument(doc([]), {to: "plain", standalone: true} as WriteOptions, {})).rejects.toMatchObject({code: "E_OPTION"});
});
it("avoids generated heading and note ID collisions with explicit container IDs", async () => {
  expect(await html([{t: "Div", c: [["same", [], []], []]}, {t: "Header", c: [1, a, [s("Same")]]},
    p({t: "Note", c: [p(s("n"))]}), {t: "Header", c: [1, a, [s("fn1")]]}])).toContain('<h1 id="same-1">Same</h1>');
  expect(await html([p({t: "Note", c: []}), {t: "Header", c: [1, a, [s("fn1")]]}])).toContain('<h1 id="fn1-1">fn1</h1>');
});
it("preserves carriage returns in DOM text and attributes; rejects unrepresentable NUL", async () => {
  const actual = await html([p({t: "Code", c: [["", [], [["data-x", "a\rb"]]], "a\rb"]})]);
  const expected = '<p><code data-x="a&#13;b">a&#13;b</code></p>\n';
  expect(actual).toBe(expected); dom(actual, expected);
  await expect(html([p(s("a\0b"))])).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("covers original HTML corpus obligations for plain code, empty definitions and heading attributes", async () => {
  const blocks: Block[] = [{t: "CodeBlock", c: [a, '<x>\n']}, {t: "CodeBlock", c: [["", ["haskell"], []], 'x < y & z']},
    {t: "DefinitionList", c: [[[], [[{t: "Plain", c: [s("empty term")]}]]]]},
    {t: "Header", c: [3, ["safe", [], [["lang", "日本語"], ["data-label", '"<&']]], [s("heading")]]}];
  const expected = '<pre><code>&lt;x&gt;\n</code></pre>\n<pre><code class="haskell">x &lt; y &amp; z</code></pre>\n<dl>\n<dt></dt>\n<dd>empty term</dd>\n</dl>\n<h3 id="safe" lang="日本語" data-label="&quot;&lt;&amp;">heading</h3>\n';
  const actual = await html(blocks); expect(actual).toBe(expected); dom(actual, expected);
  await expect(html([{t: "Header", c: [2, ["", [], [["onclick", "x"]]], [s("x")]]}])).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("preserves nested tables and rich cell content with security attributes and exact bytes", async () => {
  const table = (content: readonly Block[], spans = [1, 1]): Block => {
    const cells: Cell[] = [[a, "AlignDefault", spans[0]!, spans[1]!, content]];
    if(spans[1] === 1) cells.push([a, "AlignDefault", 1, 1, []]);
    const rows: Row[] = [[a, cells]];
    return {t: "Table", c: [a, [null, []],
      [["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]], [a, []],
      [[a, 0, [], rows]], [a, []]]};
  };
  const actual = await html([table([p({t: "Image", c: [a, [s("图")], ["a.png", ""]]}, {t: "Strong", c: [s("<&")]}), table([])], [1, 2])]);
  const expected = '<table>\n<colgroup><col><col></colgroup>\n<tbody>\n<tr><td colspan="2"><p><img src="a.png" alt="图"><strong>&lt;&amp;</strong></p>\n<table>\n<colgroup><col><col></colgroup>\n<tbody>\n<tr><td></td><td></td></tr>\n</tbody>\n</table>\n</td></tr>\n</tbody>\n</table>\n';
  expect(actual).toBe(expected); dom(actual, expected);
});
