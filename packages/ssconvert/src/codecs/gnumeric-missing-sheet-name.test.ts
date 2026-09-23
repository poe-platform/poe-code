import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 10000 } };
function input(formula: string, attributes = "", extra = "") {
  return new TextEncoder().encode(`<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/>
    <gnm:SheetNameIndex><gnm:SheetName>Here</gnm:SheetName><gnm:SheetName>Data</gnm:SheetName><gnm:SheetName>Straße</gnm:SheetName></gnm:SheetNameIndex>
    <gnm:Names><gnm:Name><gnm:name>Rate</gnm:name><gnm:value>11</gnm:value><gnm:position>A1</gnm:position></gnm:Name></gnm:Names>
    <gnm:Sheets><gnm:Sheet><gnm:Name>Here</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ${attributes}>${formula}</gnm:Cell>${extra}</gnm:Cells></gnm:Sheet>
    <gnm:Sheet><gnm:Name>Data</gnm:Name></gnm:Sheet><gnm:Sheet><gnm:Name>Straße</gnm:Name></gnm:Sheet></gnm:Sheets></gnm:Workbook>`);
}

it.each(["='Missing'!Rate", "=Missing!Rate+1", "=[]Missing!Rate", "=IF(FALSE,Missing!Rate,5)", "='s2'!Rate"])(
  "imports rejected local sheet-qualified name %s as a string formula", async formula => {
    const messages: string[] = [];
    const book = await readGnumeric(input(formula), { ...context, async diagnostic(d) { messages.push(d.message); } });
    const sheet = formula === "='s2'!Rate" ? "s2" : "Missing";
    expect(messages).toEqual([`Unparsable expression for A1: ${formula} (Unknown sheet '${sheet}')\n`]);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(`="${formula.slice(1)}"`);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: formula.slice(1) });
    const replay = await readGnumeric(await writeGnumeric(book, [], context), context);
    expect(recalculateWorkbook(replay, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: formula.slice(1) });
  });

it.each(["=Data!Rate", "='dAtA'!Rate", "='STRASSE'!Rate", "=[]Data!Rate", "=[]Rate", "='[foreign.xls]Missing'!Rate", "=\"Missing!Rate\""])(
  "preserves valid or explicitly external expression %s", async formula => {
    const messages: string[] = [];
    const book = await readGnumeric(input(formula), { ...context, async diagnostic(d) { messages.push(d.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBe(formula);
    expect(messages).toEqual([]);
  });

it("shares the recovered constant without translating or repeating the warning", async () => {
  const messages: string[] = [];
  const book = await readGnumeric(input("=Missing!Rate", 'ExprID="7"', '<gnm:Cell Row="1" Col="0" ExprID="7"/>'),
    { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toHaveLength(1);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(['="Missing!Rate"', '="Missing!Rate"']);
});

it("retains an explicit cache until forced recalculation replaces it with recovered text", async () => {
  const book = await readGnumeric(input("=Missing!Rate", 'ValueType="40" Value="19"'), context);
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 19 });
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "Missing!Rate" });
});

it("keeps typed string cell content out of formula parsing", async () => {
  const messages: string[] = [];
  const book = await readGnumeric(input("=Missing!Rate", 'ValueType="60"'), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "=Missing!Rate" });
  expect(messages).toEqual([]);
});

it.each(['Rows="0" Cols="0"', 'Rows="0" Cols="-1"', 'Rows="-1" Cols="-1"'])(
  "uses ordinary-cell recovery when array dimensions are nonpositive: %s", async attributes => {
    const book = await readGnumeric(input("=Missing!Rate", attributes), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe('="Missing!Rate"');
    expect(book.sheets[0]!.formulaGroups).toEqual([]);
  });

it("propagates cancellation requested by the warning sink", async () => {
  const controller = new AbortController();
  const reason = new Error("stop after warning");
  await expect(readGnumeric(input("=Missing!Rate"), { ...context, signal: controller.signal,
    async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});
