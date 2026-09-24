import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 10000 } };
type Declaration = readonly [string, string];
function input(globals: readonly Declaration[], locals: readonly Declaration[], formulas: readonly string[], globalsLast = false) {
  const names = (entries: readonly Declaration[]) => `<gnm:Names>${entries.map(([name, expression]) =>
    `<gnm:Name><gnm:name>${name}</gnm:name><gnm:value>${expression}</gnm:value><gnm:position>C3</gnm:position></gnm:Name>`).join("")}</gnm:Names>`;
  return new TextEncoder().encode(`<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/>
    <gnm:SheetNameIndex><gnm:SheetName>Here</gnm:SheetName><gnm:SheetName>Data</gnm:SheetName></gnm:SheetNameIndex>
    ${globalsLast ? "" : names(globals)}<gnm:Sheets><gnm:Sheet><gnm:Name>Here</gnm:Name><gnm:Cells>${formulas.map((formula, row) =>
      `<gnm:Cell Row="${row}" Col="0">${formula}</gnm:Cell>`).join("")}</gnm:Cells></gnm:Sheet><gnm:Sheet><gnm:Name>Data</gnm:Name>
    ${names(locals)}<gnm:Cells/></gnm:Sheet></gnm:Sheets>${globalsLast ? names(globals) : ""}</gnm:Workbook>`);
}

it.each([false, true])("rejects a guarded self reference in a local=%s XML declaration", async local => {
  const declarations: Declaration[] = [["Guarded", "IF(FALSE,Guarded,7)"]], messages: string[] = [];
  const bytes = input(local ? [] : declarations, local ? declarations : [], [local ? "=Data!Guarded" : "=Guarded"]);
  const before = bytes.slice();
  const book = await readGnumeric(bytes, { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual(["Ignoring would-be circular definition of Guarded\n"]);
  expect(book.names?.find(name => name.name === "Guarded")).toMatchObject({ expression: "", position: { row: 0, column: 0 } });
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 0 });
  const replay = await readGnumeric(await writeGnumeric(book, [], context), context);
  expect(recalculateWorkbook(replay, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 0 });
  expect(bytes).toEqual(before);
});

it.each([false, true])("retains accepted definitions while resolving indirect cycles in reverse source order: %s", async reversed => {
  const entries: Declaration[] = [["Alpha", "IF(FALSE,Beta,7)"], ["Beta", "Alpha"]];
  const messages: string[] = [];
  const book = await readGnumeric(input(reversed ? [...entries].reverse() : entries, [], ["=Alpha", "=Beta"]),
    { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual([`Ignoring would-be circular definition of ${reversed ? "Beta" : "Alpha"}\n`]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
    [reversed ? 7 : 0, 0].map(value => ({ kind: "number", value })));
});

it.each([false, true])("uses XML source order across global and local declaration groups: globalsLast=%s", async globalsLast => {
  const messages: string[] = [];
  const book = await readGnumeric(input([["Outer", "IF(FALSE,Data!Inner,7)"]], [["Inner", "[]Outer"]],
    ["=Outer", "=Data!Inner"], globalsLast), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual([`Ignoring would-be circular definition of ${globalsLast ? "Inner" : "Outer"}\n`]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
    [globalsLast ? 7 : 0, 0].map(value => ({ kind: "number", value })));
});

it.each([false, null])("preserves cancellation from an XML cycle warning: %s", async reason => {
  const controller = new AbortController();
  await expect(readGnumeric(input([["Guarded", "IF(FALSE,Guarded,7)"]], [], ["=Guarded"]),
    { ...context, signal: controller.signal, async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});

it("keeps differently cased names and external names out of local cycle detection", async () => {
  const messages: string[] = [];
  let externalCalls = 0;
  const scoped = { ...context, async diagnostic(d: { message: string }) { messages.push(d.message); },
    externalReferences: { resolve() { externalCalls++; throw new Error("unexpected external lookup"); } } };
  const book = await readGnumeric(input([["Guarded", "guarded"], ["guarded", "7"],
    ["External", "IF(FALSE,[other]External,7)"]], [], ["=Guarded+External"]), scoped);
  expect(recalculateWorkbook(book, scoped, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 14 });
  expect(messages).toEqual([]);
  expect(externalCalls).toBe(0);
});

it("bounds traversal of unused named definitions with the XML work limit", async () => {
  const declarations: Declaration[] = Array.from({ length: 30 }, (_, index) =>
    [`Name_${index}`, index === 29 ? "7" : `Name_${index + 1}`]);
  await expect(readGnumeric(input(declarations, [], ["=13"]),
    { ...context, limits: { ...context.limits, workbookWork: 100 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("does not mistake a missing-sheet qualifier for a local name cycle", async () => {
  const messages: string[] = [];
  const book = await readGnumeric(input([["Guarded", "MissingSheet!Guarded"]], [], []),
    { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages.some(message => message.includes("circular definition"))).toBe(false);
  expect(book.names?.find(name => name.name === "Guarded")?.expression).toBe("MissingSheet!Guarded");
});
