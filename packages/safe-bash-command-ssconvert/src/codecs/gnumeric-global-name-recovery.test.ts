import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 10000 } };
function input(formulas: readonly string[], globals = "", globalsAfter = false, extra = "") {
  const names = globals ? `<gnm:Names><gnm:Name><gnm:name>Rate</gnm:name><gnm:value>${globals}</gnm:value><gnm:position>A1</gnm:position></gnm:Name></gnm:Names>` : "";
  return new TextEncoder().encode(`<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/>
    <gnm:SheetNameIndex><gnm:SheetName>Here</gnm:SheetName></gnm:SheetNameIndex>${globalsAfter ? "" : names}<gnm:Sheets><gnm:Sheet><gnm:Name>Here</gnm:Name><gnm:Cells>
    ${formulas.map((formula, row) => `<gnm:Cell Row="${row}" Col="0">${formula}</gnm:Cell>`).join("")}${extra}
    </gnm:Cells></gnm:Sheet></gnm:Sheets>${globalsAfter ? names : ""}</gnm:Workbook>`);
}

it.each(["=[]Missing", "=[]Sheet_Title", "=[]Print_Area", "=[]Rate+1", "=IF(FALSE,[]Missing,5)"])(
  "recovers undefined explicit global %s as a constant string with a warning", async formula => {
    const messages: string[] = [];
    const book = await readGnumeric(input([formula]), { ...context, async diagnostic(d) { messages.push(d.message); } });
    const name = formula.includes("Sheet_Title") ? "Sheet_Title" : formula.includes("Print_Area") ? "Print_Area" : formula.includes("Rate") ? "Rate" : "Missing";
    expect(messages).toEqual([`Unparsable expression for A1: ${formula} (Name '${name}' does not exist in workbook)\n`]);
    expect(book.names?.filter(name => name.sheet === undefined)).toEqual([]);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: formula.slice(1) });
    const replay = await readGnumeric(await writeGnumeric(book, [], context), context);
    expect(recalculateWorkbook(replay, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: formula.slice(1) });
  });

it("does not retarget a recovered explicit global when its declaration appears later", async () => {
  const book = await readGnumeric(input(["=[]Rate"], "11", true), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "[]Rate" });
  expect(book.names?.find(name => name.sheet === undefined && name.name === "Rate")?.expression).toBe("11");
});

it("resolves an explicit global whose declaration or placeholder is already visible", async () => {
  const messages: string[] = [];
  const book = await readGnumeric(input(["=[]Rate", "=Seed+[]Seed", "=[]Seed"], "11"), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual([]);
  expect(book.names?.filter(name => name.sheet === undefined && name.name === "Seed")).toEqual([
    { name: "Seed", expression: "#NAME?", position: { sheet: "s1", row: 1, column: 0 } }
  ]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "number", value: 11 }, { kind: "error", value: "#NAME?" }, { kind: "error", value: "#NAME?" }
  ]);
});

it("stops name-creation side effects at the first rejected explicit global", async () => {
  const book = await readGnumeric(input(["=Before+[]Missing+After", "=[]Before", "=[]After"]), context);
  expect(book.names?.filter(name => name.sheet === undefined)).toEqual([
    { name: "Before", expression: "#NAME?", position: { sheet: "s1", row: 0, column: 0 } }
  ]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "Before+[]Missing+After" }, { kind: "error", value: "#NAME?" }, { kind: "string", value: "[]After" }
  ]);
});

it.each([
  ["=[]Missing+NoSheet!Rate", "Name 'Missing' does not exist in workbook"],
  ["=NoSheet!Rate+[]Missing", "Unknown sheet 'NoSheet'"]
])("reports the first name failure in %s", async (formula, reason) => {
  const messages: string[] = [];
  await readGnumeric(input([formula]), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual([`Unparsable expression for A1: ${formula} (${reason})\n`]);
});

it("shares a recovered global-name constant without warning again", async () => {
  const messages: string[] = [];
  const shared = '<gnm:Cell Row="0" Col="0" ExprID="7">=[]Missing</gnm:Cell><gnm:Cell Row="1" Col="0" ExprID="7"/>';
  const book = await readGnumeric(input([], "", false, shared), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toHaveLength(1);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "[]Missing" }, { kind: "string", value: "[]Missing" }
  ]);
});

it("propagates cancellation from an explicit-global recovery diagnostic", async () => {
  const controller = new AbortController(), reason = new Error("stop after global warning");
  await expect(readGnumeric(input(["=[]Missing"]), { ...context, signal: controller.signal,
    async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});
