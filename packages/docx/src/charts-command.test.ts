import { expect, it } from "vitest";
import { Volume } from "memfs";
import { paragraph, textFixture, textContext } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { chartFixture, chartSpace, chartContext, sheetMime } from "../tests/fixtures/charts.js";
import { inspectDocumentCharts } from "./charts.js";

it("returns an empty physical inventory through one explicit memfs read without mutation", async () => {
  const bytes = await textFixture(paragraph("Original chart area")), volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) }); let reads = 0, stdout = "", stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["charts", "list", "input.docx", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(b) { stdout += new TextDecoder().decode(b); } }, stderr: { async write(b) { stderr += new TextDecoder().decode(b); } } });
  expect(result.exitCode, stderr).toBe(0); expect(reads).toBe(1); expect(JSON.parse(stdout)).toMatchObject({ version: 1, operation: "charts.list", ok: true, data: { items: [] }, affected: 0, locations: [], warnings: [], errors: [] });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
});

it("pairs CLI and SDK nested source/cache/binding snapshots without scalar coercion", async () => {
  const groups = '<c:barChart><c:ser><c:idx val="0"/><c:order val="2"/><c:tx><c:v>Original series</c:v></c:tx><c:cat><c:multiLvlStrRef><c:f>Data!A2:A3</c:f><c:multiLvlStrCache><c:ptCount val="999999999999999999999"/><c:lvl><c:pt idx="8"><c:v>Upper</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat><c:val><c:numRef><c:f>Data!B2:B3</c:f><c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="2"/><c:pt idx="7"><c:v>12.50</c:v></c:pt><c:pt idx="7"><c:v/></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart>';
  const input = await chartFixture({ definitions: [{ name: "word/charts/plot.xml", xml: chartSpace(groups, false, '<c:externalData r:id="book"><c:autoUpdate val="1"/></c:externalData>') }],
    resources: [{ name: "word/embeddings/data.bin", bytes: new Uint8Array([9, 2, 7, 4]), type: sheetMime }],
    relationships: [{ owner: "/word/charts/plot.xml", id: "book", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package", target: "../embeddings/data.bin" }] });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input) }); let stdout = "", stderr = "", reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: chartContext.limits }).execute({ args: ["charts", "list", "input.docx", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: chartContext.signal,
    filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, stderr).toBe(0); expect(reads).toBe(1);
  const cli = JSON.parse(stdout), sdk = await inspectDocumentCharts(input, {}, chartContext);
  expect(cli.data.items).toEqual(sdk.items); expect(cli.warnings).toEqual(sdk.warnings);
  const details = cli.data.items[0].details;
  expect(details.externalData[0]).toMatchObject({ autoUpdate: ["1"], binding: { status: "internal", target: { contentType: sheetMime, bytes: 4 } } });
  expect(details.series[0].cachedValues).toEqual(["12.50", ""]);
  expect(details.series[0].sources.find((source: { role: string }) => source.role === "category").caches[0]).toMatchObject({ kind: "multilevel-string", counts: ["999999999999999999999"], levels: [{ points: [{ index: "8", values: ["Upper"] }] }] });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});

it("rejects scoped chart selectors before poisoned document capability I/O", async () => {
  let reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["charts", "list", "input.docx", "--scope", "headers", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { reads++; throw new Error("Poisoned capability must remain untouched"); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(2); expect(reads).toBe(0);
});
