import { expect, it } from "vitest";
import { Volume } from "memfs";
import { runInNewContext } from "node:vm";
import { createEngine } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import { probeHtml, readHtml } from "./html.js";
import { writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } };
const bytes = (html: string) => new TextEncoder().encode(html);

it("accepts foreign-realm HTML bytes and propagates diagnostic failures without coercion", async () => {
  const input = '<table><tr><td><textarea><b>4</b></textarea><td>6</table>';
  const foreign = runInNewContext("Uint8Array.from(input)", { input: [...bytes(input)] }) as Uint8Array;
  expect(foreign instanceof Uint8Array).toBe(false);
  expect(probeHtml(foreign, context)).toBe(true);
  expect(await readHtml(foreign, context)).toEqual(await readHtml(bytes(input), context));
  const reason = Object.freeze({ kind: "diagnostic-failure" });
  await expect(readHtml(bytes('<table><tr><td>&#;</table>'), { ...context, async diagnostic() { throw reason; } })).rejects.toBe(reason);
});

it("preserves serialized captions, repeated names and the global row cursor", async () => {
  const book = await readHtml(bytes('<table><caption>A &amp; B</caption><tr><td>1</table><table><caption><b>Z</b></caption><tr><td>2</table><table><caption>A &amp; B</caption><tr><td>3</table>'), context);
  expect(book.sheets.map(s => [s.name, s.cells.map(c => [c.row, c.value])])).toEqual([
    ["A &amp; B", [[0, { kind: "number", value: 1 }], [2, { kind: "number", value: 3 }]]],
    ["<b>Z</b>", [[1, { kind: "number", value: 2 }]]]
  ]);
});

it("creates nested sheets in encounter order and stores their explanation as a comment", async () => {
  const book = await readHtml(bytes('<table><caption>Outer</caption><tr><td>before<table><tr><td>inner</table>after<td>end</table>'), context);
  expect(book.sheets.map(s => s.name)).toEqual(["Outer", "Sheet1"]);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "before[see sheet Sheet1]after" });
  expect(book.sheets[1]!.cells[0]!.value).toEqual({ kind: "string", value: "inner" });
  expect(JSON.stringify(book.sheets[0]!.unsupportedRecords)).toContain("The original html file is\\nusing nested tables.");
});

it("skips occupied merge columns and follows native mixed row-section extraction", async () => {
  const book = await readHtml(bytes('<table><tr><td rowspan=2 colspan=2>1<td>2<tr><td>3</table>'), context);
  expect(book.sheets[0]!.cells.map(c => [c.row, c.column])).toEqual([[0, 0], [0, 2], [1, 2]]);
  expect(book.sheets[0]!.merges).toEqual([{ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }]);
  const sections = await readHtml(bytes('<table><thead><tr><td>h</thead><tr><td>d<tbody><tr><td>b</tbody><tfoot><tr><td>f</tfoot></table>'), context);
  expect(sections.sheets[0]!.cells.map(c => c.value)).toEqual([{ kind: "string", value: "h" }, { kind: "string", value: "d" }]);
});

it("retains links and image comments while treating scripts and CSS as inert ignored content", async () => {
  const diagnostics: string[] = [];
  const book = await readHtml(bytes('<html><head><title>Title</title><script>head()</script><style>body{}</style></head><body><table><tr><td style="color:red" x:num="99">a<script>alert(1)</script>b<style>css</style><img src="https://x/a?x=1&amp;y=2"><a href="mailto:x&amp;y">link</a></table></body></html>'), { ...context, async diagnostic(d) { diagnostics.push(d.message); } });
  expect(book.sheets[0]!.cells.map(c => [c.row, c.column, c.value])).toEqual([
    [0, 1, { kind: "string", value: "Title" }], [1, 0, { kind: "string", value: "ablink" }]
  ]);
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('type="GnmHLinkEMail"');
  expect(xml).toContain('target="mailto:x&amp;amp;y"');
  expect(xml).toContain('https://x/a?x=1&amp;amp;y=2');
  expect(diagnostics).toEqual([]);
});

it("matches text, errors, formulas and number inference without applying Excel attributes", async () => {
  const book = await readHtml(bytes('<table><tr><td x:str>001<td>12%<td>TRUE<td>=1+2<td>\'12<td>1,234<td>1/2/2000<td>#N/A</table>'), context);
  expect(book.sheets[0]!.cells.map(c => c.value)).toEqual([
    { kind: "number", value: 1 }, { kind: "number", value: 0.12 }, { kind: "boolean", value: true },
    { kind: "blank" }, { kind: "string", value: "12" }, { kind: "number", value: 1234 },
    { kind: "number", value: 36527 }, { kind: "error", value: "#N/A" }
  ]);
  expect(book.sheets[0]!.cells[1]!.format).toBe("0.00%");
  expect(book.sheets[0]!.cells[3]!.formula).toBe("=1+2");
});

it("uses the native 200-byte content probe and accepts explicitly selected clipboard fragments", async () => {
  expect(probeHtml(bytes(" ".repeat(200) + "<table>"), context)).toBe(false);
  expect(probeHtml(bytes("<TABLEgarbage>"), context)).toBe(true);
  expect(probeHtml(bytes("<td>1<td>2"), context)).toBe(false);
  const book = await readHtml(bytes('<td>1<td>2<p>text</p><tr><td>3'), context);
  expect(book.sheets[0]!.cells.map(c => c.value)).toEqual([{ kind: "number", value: 1 }, { kind: "string", value: "2text" }, { kind: "number", value: 3 }]);
});

it("imports recovered HTML tables through the SDK with native shared-sheet ordering", async () => {
  const volume = Volume.fromJSON({ "/book.html": '<table><tr><th>A<td>12<tr><td>x<br>y<td>&amp;&nbsp;z</table><table><tr><td>tail</table>' });
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 },
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  const operation = { signal: new AbortController().signal };
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.html" }, {}, operation);
    expect(book.sheets).toMatchObject([{ name: "Sheet1", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "A" } },
      { row: 0, column: 1, value: { kind: "number", value: 12 } },
      { row: 1, column: 0, value: { kind: "string", value: "xy" } },
      { row: 1, column: 1, value: { kind: "string", value: "&\u00a0z" } },
      { row: 2, column: 0, value: { kind: "string", value: "tail" } }
    ] }]);
    const result = await engine.convert({ input: { kind: "resource", uri: "/book.html" }, destination: { kind: "resource", uri: "/out.csv" }, exportType: "Gnumeric_stf:stf_csv" }, operation);
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(volume.readFileSync("/out.csv", "utf8")).toBe('A,12\nxy,&\u00a0z\ntail,\n');
  } finally { await engine.dispose(); }
});
