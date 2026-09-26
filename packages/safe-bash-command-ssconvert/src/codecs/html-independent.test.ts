import { expect, it } from "vitest";
import { readHtml } from "./html.js";
import type { CapabilityContext } from "../contracts.js";

function context(limits: Partial<CapabilityContext["limits"]> = {}): CapabilityContext {
  return { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000, ...limits }, own() {} };
}
const bytes = (text: string) => new TextEncoder().encode(text);

it("matches libxml numeric entity recovery without HTML5 substitutions", async () => {
  const book = await readHtml(bytes('<table><tr><td>&amp &lt &copy &#65 &#x41 &#X41; &#0; &#xD800; &#128; &apos;</td></tr></table>'), context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "&amp &lt &copy A A A \u0080 '" });
});

it("retains native malformed-row and self-closing nonvoid recovery", async () => {
  const book = await readHtml(bytes('<table><tr><td>one<p>two<td>three<tr><td>four</table><table><tr><td>a<span/>b<td>c</table>'), context());
  expect(book.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
    [0, 0, { kind: "string", value: "onetwo" }], [0, 1, { kind: "string", value: "three" }],
    [1, 0, { kind: "string", value: "four" }], [2, 0, { kind: "string", value: "ab" }], [2, 1, { kind: "string", value: "c" }]
  ]);
});

it("does not execute active content or acquire image and frame resources", async () => {
  const book = await readHtml(bytes('<html><head><script>alert(1)</script><style>body{color:red}</style></head><body><table><tr><td>a<script>BAD</script>b<style>BAD</style>c<img src="https://invalid.test/x"><iframe src="https://invalid.test">hidden</iframe></td></tr></table></body></html>'), context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "abchidden" });
  expect(book.sheets[0]!.unsupportedRecords?.[0]?.data).toMatchObject({ children: [{ attributes: expect.arrayContaining([{ name: "Text", namespace: "", value: "https://invalid.test/x\n" }]) }] });
});

it("enforces HTML node, text, and work admission limits", async () => {
  const input = bytes('<table><tr><td>hello</td></tr></table>');
  await expect(readHtml(input, context({ workbookNodes: 2 }))).rejects.toMatchObject({ code: "resource-limit" });
  await expect(readHtml(input, context({ workbookTextBytes: 2 }))).rejects.toMatchObject({ code: "resource-limit" });
  await expect(readHtml(input, context({ workbookWork: 2 }))).rejects.toMatchObject({ code: "resource-limit" });
});

it("ignores charset declarations inside HTML comments", async () => {
  const input = Uint8Array.from([...'<\u0021-- <meta charset="UTF-8"> --><table><tr><td>caf\u00e9</table>'].map(c => c.charCodeAt(0)));
  const book = await readHtml(input, context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "café" });
});

it("preserves reference UTF16 BOM as imported text before table rows", async () => {
  const text = '<table><tr><td>café €</table>';
  const input = new Uint8Array(2 + text.length * 2);
  input[0] = 255; input[1] = 254;
  for (let at = 0; at < text.length; at++) { input[2 + at * 2] = text.charCodeAt(at) & 255; input[3 + at * 2] = text.charCodeAt(at) >> 8; }
  const book = await readHtml(input, context());
  expect(book.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
    [0, 1, { kind: "string", value: "\ufeff" }], [1, 0, { kind: "string", value: "café €" }]
  ]);
});

it("emits measured native numeric-reference parser diagnostics with source carets", async () => {
  const diagnostics: string[] = [];
  await readHtml(bytes('<table><tr><td>&#0;</td></tr></table>'), {
    ...context(), inputFilename: "/book.html", async diagnostic(diagnostic) { diagnostics.push(diagnostic.message); }
  });
  expect(diagnostics).toEqual(['/book.html:1: HTML parser error : htmlParseCharRef: invalid xmlChar value 0\n<table><tr><td>&#0;</td></tr></table>\n                   ^\n']);
});

it("emits native unknown-HTML4-element diagnostics while retaining its content", async () => {
  const diagnostics: string[] = [];
  const book = await readHtml(bytes('<table><tr><td><widget title="x">hello</widget></td></tr></table>'), {
    ...context(), inputFilename: "/book.html", async diagnostic(diagnostic) { diagnostics.push(diagnostic.message); }
  });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "hello" });
  expect(diagnostics).toEqual(['/book.html:1: HTML parser error : Tag widget invalid\n<table><tr><td><widget title="x">hello</widget></td></tr></table>\n                                ^\n']);
});

it("retains caption markup naming and nested extraction order", async () => {
  const book = await readHtml(bytes('<table><caption>Outer</caption><tr><td>a<table><caption>N &amp; X</caption><tr><td>inner</table>b</table><table><tr><td>tail</table>'), context());
  expect(book.sheets.map(s => [s.name, s.cells.map(c => [c.row, c.column, c.value])])).toEqual([
    ["Outer", [[0, 0, { kind: "string", value: "a[see sheet 'N &amp; X']b" }], [1, 0, { kind: "string", value: "tail" }]]],
    ["N &amp; X", [[0, 0, { kind: "string", value: "inner" }]]]
  ]);
});

it("retains native whitespace across comments and inline formatting", async () => {
  const book = await readHtml(bytes('<table><tr><td>a<!--note--> <b>b</b>\n<i>c</i></td></tr></table>'), context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "a b\nc" });
});

it("preserves cancellation reason identity before parsing and after awaited diagnostics", async () => {
  const reason = { kind: "cancel-html" };
  const initial = new AbortController(); initial.abort(reason);
  await expect(readHtml(bytes('<table><tr><td>x</table>'), { ...context(), signal: initial.signal })).rejects.toBe(reason);
  const during = new AbortController();
  await expect(readHtml(bytes('<table><tr><td>&#0;&#0;x</table>'), { ...context(), signal: during.signal,
    async diagnostic() { await Promise.resolve(); during.abort(reason); }
  })).rejects.toBe(reason);
});

it("enforces sheet, cell, and parser-depth admission limits", async () => {
  await expect(readHtml(bytes('<table><caption>A</caption><tr><td>x<table><caption>B</caption><tr><td>y</table></table>'), context({ sheets: 1 }))).rejects.toMatchObject({ code: "resource-limit" });
  await expect(readHtml(bytes('<table><tr><td>x<td>y</table>'), context({ cells: 1 }))).rejects.toMatchObject({ code: "resource-limit" });
  await expect(readHtml(bytes('<div>'.repeat(257) + 'x' + '</div>'.repeat(257)), context())).rejects.toMatchObject({ code: "resource-limit" });
});

it("preserves native nonascii caption names, link targets, and image comments", async () => {
  const book = await readHtml(bytes('<html><head><meta charset="utf-8"></head><body><table><caption>é € \u00a0 😀</caption><tr><td><a href="https://x/é">L</a><img src="é"></table></body></html>'), context());
  const sheet = book.sheets[0]!;
  expect(sheet.name).toBe("é € \u00a0 😀");
  expect(sheet.cells[0]!.style?.gnumeric).toMatchObject({ children: expect.arrayContaining([
    { name: "HyperLink", namespace: "http://www.gnumeric.org/v10.dtd", text: "", children: [], attributes: [
      { name: "type", namespace: "", value: "GnmHLinkURL" }, { name: "target", namespace: "", value: "https://x/é" }
    ] }
  ]) });
  expect(sheet.unsupportedRecords?.[0]?.data).toMatchObject({ children: [{ attributes: expect.arrayContaining([{ name: "Text", namespace: "", value: "é\n" }]) }] });
});


it("consumes empty numeric references with native zero-value warnings", async () => {
  const diagnostics: string[] = [];
  const book = await readHtml(bytes('<table><tr><td>A&#;B&#x;C&#X;D</table>'), {
    ...context(), inputFilename: "/book.html", async diagnostic(diagnostic) { diagnostics.push(diagnostic.message); }
  });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "ABCD" });
  expect(diagnostics).toEqual([19, 24, 29].map(column =>
    '/book.html:1: HTML parser error : htmlParseCharRef: invalid xmlChar value 0\n' +
    '<table><tr><td>A&#;B&#x;C&#X;D</table>\n' + ' '.repeat(column) + '^\n'));
});


it("replaces literal NUL text with native blank and source warning", async () => {
  const diagnostics: string[] = [];
  const book = await readHtml(bytes('<table><tr><td>a\u0000b</table>'), {
    ...context(), inputFilename: "/book.html", async diagnostic(diagnostic) { diagnostics.push(diagnostic.message); }
  });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "a b" });
  expect(diagnostics).toEqual(['/book.html:1: HTML parser error : Char 0x0 out of allowed range\n<table><tr><td>a\n                ^\n']);
});


it("parses textarea and title child markup as native HTML4 rather than HTML5 raw text", async () => {
  const textarea = await readHtml(bytes('<table><tr><td>a<textarea><b>x</b>&amp;</textarea>b<td>tail</table>'), context());
  expect(textarea.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
    [0, 0, { kind: "string", value: "ax&b" }], [0, 1, { kind: "string", value: "tail" }]
  ]);
  const title = await readHtml(bytes('<html><head><title><b>X</b>&amp;</title></head><body><table><tr><td>safe</table></body></html>'), context());
  expect(title.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
    [0, 1, { kind: "string", value: "X" }], [1, 1, { kind: "string", value: "&" }], [2, 0, { kind: "string", value: "safe" }]
  ]);
});


it("keeps scripts inert while reparsing textarea markup across tokenizer chunks", async () => {
  const script = await readHtml(bytes('<table><tr><td>a<textarea><script><table><tr><td>BAD</script><b>x</b></textarea>b</table>'), context());
  expect(script.sheets).toHaveLength(1);
  expect(script.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "axb" });
  const boundary = await readHtml(bytes('<table><tr><td><textarea>' + 'a'.repeat(4070) + '<b>x</b>&amp;</textarea></table>'), context());
  expect(boundary.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: 'a'.repeat(4070) + 'x&' });
});

it("extracts visible outside-table text while excluding script and style payloads", async () => {
  const book = await readHtml(bytes('<html><head><script><table><tr><td>BAD</table></script><style><table>BAD</table></style></head><body><script>BAD</script><style>BAD</style><p>before</p><table><tr><td>safe</table><p>after</p></body></html>'), context());
  expect(book.sheets).toHaveLength(1);
  expect(book.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
    [0, 1, { kind: "string", value: "before" }], [1, 0, { kind: "string", value: "safe" }], [2, 1, { kind: "string", value: "after" }]
  ]);
});
