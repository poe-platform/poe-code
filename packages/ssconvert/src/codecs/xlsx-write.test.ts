import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine } from "../engine.js";
import { createRegistry } from "./registry.js";
import { runCommand } from "../cli.js";
import type { Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { readGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 3, operations: 1000 } };
const book: Workbook = { dateSystem: "1904", calculationMode: "manual", names: [{ name: "Total", expression: "=S!$B$1" }],
  sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 1, formula: "=1+2", value: { kind: "number", value: 3 }, cachedResult: { kind: "number", value: 3 } },
    { row: 0, column: 0, value: { kind: "string", value: "a&b" }, format: "0.000" },
    { row: 1, column: 0, formula: '=IF(TRUE,"yes","no")', value: { kind: "string", value: "yes" }, cachedResult: { kind: "string", value: "yes" } }
  ], merges: [{ startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 }] }] };

it.each(["xlsx", "xlsx2"])("exports %s through the actual SDK with distinct profile attributes and caches", async profile => {
  const engine = createEngine({ codecs: [{ id: "fixture", description: "fixture", extensions: [], async read() { return book; } }],
    environment: context.environment, limits: context.limits });
  const output: Uint8Array[] = [];
  try {
    const owned = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, context);
    const result = await engine.writeWorkbook(owned, { kind: "stream", sink: { async write(bytes) { output.push(new Uint8Array(bytes)); } } },
      { exportType: `Gnumeric_Excel:${profile}` }, context);
    expect(result.exitCode).toBe(0); expect(output).toHaveLength(1);
    const parts = await unpack(output[0]!);
    expect(parts.get("xl/workbook.xml")).toContain(profile === "xlsx" ? 'codePage="1252"' : 'characterSet="UTF-8"');
    expect(parts.get("xl/workbook.xml")).toContain('date1904="1"');
    expect(parts.get("xl/workbook.xml")).toContain('calcMode="manual"');
    expect(parts.get("xl/workbook.xml")).toContain('<definedName name="_xlnm.Sheet_Title" localSheetId="0">&quot;S&quot;</definedName>');
    expect(parts.get("xl/workbook.xml")).toContain('<definedName name="_xlnm.Print_Area" localSheetId="0">#REF!</definedName>');
    expect(parts.get("xl/worksheets/sheet1.xml")).toContain('<f>1+2</f><v>3</v>');
    expect(parts.get("xl/worksheets/sheet1.xml")).toContain('<v>yes</v>');
    expect(parts.get("xl/worksheets/sheet1.xml")).toContain('ref="A3:B4"');
    expect(parts.get("xl/styles.xml")).toContain('formatCode="0.000"');
    expect(parts.get("xl/styles.xml")).toContain(profile === "xlsx" ? '<left style="none">' : '<start style="none">');
    const reopened = await engine.readWorkbook({ kind: "stream", source: output }, {}, context);
    expect(reopened.sheets[0]!.cells[1]).toMatchObject({ formula: "=1+2", cachedResult: { kind: "number", value: 3 } });
  } finally { await engine.dispose(); }
});
it("rejects cancellation and output budget before publishing an XLSX artifact", async () => {
  const engine = createEngine({ codecs: [], environment: context.environment, limits: { ...context.limits, outputBytes: 200 } });
  let writes = 0;
  try {
    const owned = await engine.readWorkbook({ kind: "stream", filename: "in.csv", source: [new TextEncoder().encode("x\n")] }, {}, context);
    await expect(engine.writeWorkbook(owned, { kind: "stream", sink: { async write() { writes++; } } },
      { exportType: "Gnumeric_Excel:xlsx" }, context)).rejects.toMatchObject({ code: "resource-limit" });
    expect(writes).toBe(0);
    const controller = new AbortController(); const reason = { cancelled: true }; controller.abort(reason);
    await expect(readXlsx(new Uint8Array(), { ...context, signal: controller.signal })).rejects.toBe(reason);
  } finally { await engine.dispose(); }
});
it("resolves .xlsx to the second edition and converts command files exclusively through memfs", async () => {
  expect(createRegistry([]).select("write", undefined, "out.xlsx")?.id).toBe("Gnumeric_Excel:xlsx2");
  const volume = Volume.fromJSON({ "/in.csv": "x,3\n" });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  try {
    const result = await runCommand(["/in.csv", "/out.xlsx"], engine, {
      stdout: { async write() {} }, stderr: { async write() {} }, ...context });
    expect(result.exitCode).toBe(0);
    expect((await unpack(new Uint8Array(volume.readFileSync("/out.xlsx") as Uint8Array))).get("xl/workbook.xml")).toContain('characterSet="UTF-8"');
  } finally { await engine.dispose(); }
});

async function unpack(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = createZipCodec(); const limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, limits, new AbortController().signal); const result = new Map<string, string>();
  for (const entry of archive.entries) {
    let text = ""; const decoder = new TextDecoder();
    for await (const chunk of zip.decodeZipEntry(entry, limits, new AbortController().signal)) text += decoder.decode(chunk, { stream: true });
    result.set(entry.name, text + decoder.decode());
  }
  return result;
}

it.each(["2006", "2008"] as const)("%s preserves axis metadata beyond populated cells and native merge attributes", async edition => {
  const input: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }],
    rows: [{ index: 8, hidden: true, collapsed: true, outlineLevel: 2 }], columns: [{ index: 4, hidden: true }],
    merges: [{ startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 }] }] };
  const parts = await unpack(await createXlsxWriter(edition)(input, [], context));
  const sheet = parts.get("xl/worksheets/sheet1.xml")!;
  expect(sheet).toContain('<dimension ref="A1:E9"/>');
  expect(sheet).toContain('<sheetFormatPr defaultColWidth="48" defaultRowHeight="12.75" outlineLevelRow="2"/>');
  expect(sheet).toContain('<row r="9" spans="1:5" collapsed="1" hidden="1" outlineLevel="2"/>');
  expect(sheet).toContain('<mergeCells><mergeCell ref="A3:B4"/></mergeCells>');
  const reopened = await readXlsx(await createXlsxWriter(edition)(input, [], context), context);
  expect(reopened.sheets[0]!.rows).toContainEqual(expect.objectContaining({ index: 8, hidden: true, collapsed: true, outlineLevel: 2 }));
});

it.each(["2006", "2008"] as const)("%s exports imported axis settings without false loss warnings or synthetic hard sizes", async edition => {
  const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" Version="14"><g:Sheets><g:Sheet Rows="65536" Cols="256"><g:Name>S</g:Name><g:Cols><g:ColInfo No="4" Unit="48" Hidden="1"/></g:Cols><g:Rows><g:RowInfo No="8" Unit="12.75" Hidden="1" Collapsed="1" OutlineLevel="2"/><g:RowInfo No="9" Unit="20" HardSize="1"/></g:Rows><g:Cells><g:Cell Row="0" Col="0" ValueType="40">1</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>';
  const input = await readGnumeric(new TextEncoder().encode(source), context);
  const warnings: string[] = [];
  const parts = await unpack(await createXlsxWriter(edition)(input, [], { ...context, async diagnostic(value) { warnings.push(value.message); } }));
  expect(warnings).toEqual([]);
  expect(parts.get("xl/worksheets/sheet1.xml")).toContain('<row r="9" spans="1:5" ht="12.75" collapsed="1" hidden="1" outlineLevel="2"/>');
  expect(parts.get("xl/worksheets/sheet1.xml")).toContain('<row r="10" spans="1:5" customHeight="1" ht="20"/>');
  expect(parts.get("xl/worksheets/sheet1.xml")).toContain('<col min="5" max="5" style="0" width="9.142307692307693" hidden="1"/>');
});
