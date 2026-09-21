import { expect, it } from "vitest";
import { readGnumeric, writeGnumeric } from "../codecs/gnumeric.js";
import { renameWorkbookSheet } from "../formulas/workbook.js";
import { resizeWorkbookReferences } from "../workbook/resize.js";
import { mergeWorkbookSheets } from "../workbook/merge.js";
import { sheetObjects } from "./index.js";
import type { CapabilityContext } from "../contracts.js";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const source = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:SheetObjectGraph Name="Mixed" ObjectBound="A1:B2"><GogObject type="GogGraph"><GogObject type="GogChart" role="Chart"><GogObject type="GogLabel" role="Title"><data><dimension id="0" type="GODataScalarStr">S!$A$1 literal title</dimension></data></GogObject><GogObject type="GogXYPlot" role="Plot"><GogObject type="GogXYSeries" role="Series"><data><dimension id="-1" type="GnmGODataScalar">S!$A$3</dimension><dimension id="0" type="GODataVectorVal">1;2;3</dimension><dimension id="1" type="GnmGODataVector">S!$A$1:$A$3</dimension></data></GogObject></GogObject></GogObject></GogObject></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
const read = (xml: string) => readGnumeric(new TextEncoder().encode(xml), context);

it("renames linked dimensions without parsing literal GOffice data as formulas", async () => {
  const book = await read(source);
  const renamed = renameWorkbookSheet(book, book.sheets[0]!.id, "Renamed", context);
  const xml = new TextDecoder().decode(await writeGnumeric(renamed, [], context));
  expect(xml).toContain("S!$A$1 literal title");
  expect(xml).toContain("1;2;3");
  expect(xml).toContain("'Renamed'!$A$1:$A$3");
  expect(xml).toContain("'Renamed'!$A$3");
});

it("clips and removes chart source references during resize while preserving literals", async () => {
  const book = await read(source.replaceAll("$A$3", "$A$129"));
  const resized = resizeWorkbookReferences(book, book.sheets[0]!.id, { rows: 128, columns: 128 }, context);
  const xml = new TextDecoder().decode(await writeGnumeric(resized, [], context));
  expect(xml).toContain("S!$A$1 literal title");
  expect(xml).toContain("'S'!$A$1:$A$128");
  expect(xml).toContain("#REF!");
  expect(sheetObjects(resized.sheets[0]!, context)).toHaveLength(1);
});

it("rehomes colliding source sheets during merge without modifying literal titles", async () => {
  const book = await read(source);
  const merged = mergeWorkbookSheets(book, book, context.limits, context);
  const xml = new TextDecoder().decode(await writeGnumeric(merged, [], context));
  expect(merged.sheets.map(sheet => sheet.name)).toEqual(["S", "S(2)"]);
  expect(xml).toContain("'S(2)'!$A$1:$A$3");
  expect(xml.split("S!$A$1 literal title")).toHaveLength(3);
});

it("keeps linked data live through command and SDK updates, recalc, checkpoint and replay", async () => {
  const volume = Volume.fromJSON({ "/original.xml": source.replace("<g:Cells/>", '<g:Cells><g:Cell Row="0" Col="0" ValueType="40">2</g:Cell><g:Cell Row="1" Col="0">=A1*2</g:Cell></g:Cells>') });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  const diagnostics: string[] = [];
  const operation = { signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { diagnostics.push(new TextDecoder().decode(bytes)); } } };
  try {
    const before = await engine.readWorkbook({ kind: "resource", uri: "/original.xml" }, {}, context);
    expect((await runCommand(["--set", "A1=5", "--recalc", "-T", "Gnumeric_XmlIO:sax:0", "/original.xml", "/command.xml"], engine, operation)).exitCode).toBe(0);
    expect((await engine.convert({ input: { kind: "resource", uri: "/original.xml" }, destination: { kind: "resource", uri: "/sdk.xml" }, exportType: "Gnumeric_XmlIO:sax:0", updateExpressions: ["A1=5"], recalc: true }, operation)).exitCode).toBe(0);
    expect(volume.readFileSync("/command.xml")).toEqual(volume.readFileSync("/sdk.xml"));
    const checkpoint = recalculateWorkbook(await engine.readWorkbook({ kind: "resource", uri: "/sdk.xml" }, {}, context), context, true);
    expect(checkpoint.sheets[0]!.cells.find(cell => cell.row === 1)?.value).toEqual({ kind: "number", value: 10 });
    expect(sheetObjects(checkpoint.sheets[0]!, context)[0]!.graph).toEqual(sheetObjects(before.sheets[0]!, context)[0]!.graph);
    expect((await runCommand(["--set", "A1=7", "--recalc", "-T", "Gnumeric_XmlIO:sax:0", "/sdk.xml", "/replay.xml"], engine, operation)).exitCode).toBe(0);
    const replay = recalculateWorkbook(await engine.readWorkbook({ kind: "resource", uri: "/replay.xml" }, {}, context), context, true);
    expect(replay.sheets[0]!.cells.find(cell => cell.row === 1)?.value).toEqual({ kind: "number", value: 14 });
    expect(sheetObjects(replay.sheets[0]!, context)[0]!.graph).toEqual(sheetObjects(checkpoint.sheets[0]!, context)[0]!.graph);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(volume.toJSON()).sort()).toEqual(["/command.xml", "/original.xml", "/replay.xml", "/sdk.xml"]);
  } finally { await engine.dispose(); }
});
