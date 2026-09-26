import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readQpro } from "./qpro.js";
import { readPln } from "./pln.js";

function context(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 100 }, ...overrides };
}
function record(id: number, data: number[] = []): number[] {
  return [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data];
}
function qpro(records: number[]): Uint8Array {
  return Uint8Array.from([...record(0, [1, 16]), ...record(202), ...records, ...record(203), ...record(1)]);
}
function qformula(tokens: number[]): number[] {
  return record(16, [...Array<number>(18).fill(0), tokens.length, 0, ...tokens]);
}
function pln(records: number[] = []): Uint8Array {
  return Uint8Array.from([255, 87, 80, 67, 16, 0, 0, 0, 9, 10, 5, 0, 0, 0, 0, 0, ...record(25), ...records]);
}

it("PlanPerfect admits its sheet only inside the sheet budget", async () => {
  const c = context();
  await expect(readPln(pln(), { ...c, limits: { ...c.limits, sheets: 0 } })).rejects.toThrow("sheets limit exceeded");
});

it("Quattro formula token work respects the operation budget before creating a formula", async () => {
  const c = context();
  await expect(readQpro(qpro(qformula([5, 1, 0, 8, 8, 3])),
    { ...c, limits: { ...c.limits, operations: 2 } })).rejects.toThrow("operations limit exceeded");
});

it("Quattro replacement cells consume one distinct cell slot", async () => {
  const c = context();
  const book = await readQpro(qpro([...record(13, [0, 0, 0, 0, 0, 0, 1, 0]),
    ...record(13, [0, 0, 0, 0, 0, 0, 2, 0])]), { ...c, limits: { ...c.limits, cells: 1 } });
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 2 } }]);
});

it("Quattro formula stack underflow warns once about corruption and retains later cells", async () => {
  const warnings: string[] = [];
  const book = await readQpro(qpro([...qformula([9, 3]), ...record(13, [1, 0, 0, 0, 0, 0, 7, 0])]),
    context({ async diagnostic(d) { warnings.push(d.message); } }));
  expect(warnings).toEqual(["File is most likely corrupted.\n", 'Condition "stack && stack->next" failed.\n']);
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 1, value: { kind: "number", value: 7 } }]);
});

it("Quattro cancellation in the diagnostic callback preserves the exact abort reason", async () => {
  const controller = new AbortController(), reason = new Error("stress abort");
  await expect(readQpro(qpro(record(13, [0])), context({ signal: controller.signal,
    async diagnostic() { controller.abort(reason); } }))).rejects.toBe(reason);
});

it("PlanPerfect format-only records retain styles and do not consume formula bytes as cells", async () => {
  const cell = Array<number>(20).fill(0); cell[0] = 128; cell[12] = 6; cell[18] = 3;
  const book = await readPln(pln([...cell, 1, 0, 255]), context());
  expect(book.sheets[0]!.cells).toEqual([{ row: 128, column: 0, value: { kind: "blank" },
    style: { HAlign: 1, italic: false, hidden: false, underline: 0, bold: true } }]);
});

it.each([readQpro, readPln])("binary readers reject cancellation before input admission (%#)", async reader => {
  const controller = new AbortController(), reason = { stress: "cancelled" }; controller.abort(reason);
  await expect(reader(new Uint8Array(), context({ signal: controller.signal }))).rejects.toBe(reason);
});

it("Quattro raw diagnostic bytes preserve exactly one final newline in source order", async () => {
  const warnings: string[] = [];
  await readQpro(qpro([...record(13, [0]), ...record(309, [100, 0, 9, 0])]),
    context({ async diagnostic(d) { expect(d.bytes).toBeInstanceOf(Uint8Array); warnings.push(new TextDecoder().decode(d.bytes)); } }));
  expect(warnings).toEqual(["File is most likely corrupted.\n", "Invalid 'QPRO_INTEGER_CELL' record of length 1 instead of 8\n", ""]);
});

it("PlanPerfect translated literal tokens respect the formula text budget", async () => {
  const formula = [40, 0, ...Array<number>(40).fill(14)];
  const cell = Array<number>(20).fill(0); cell[12] = 1; cell[18] = formula.length;
  const bytes = pln([...cell, ...formula]), c = context();
  await expect(readPln(bytes, { ...c, limits: { ...c.limits, inputBytes: bytes.length } })).rejects.toThrow("formula length limit exceeded");
});

it("PlanPerfect cumulative formula tokens admit the exact boundary and reject the following cell", async () => {
  const formula = [7, 0, 10, 1, 49, 1, 10, 1, 50];
  const cell = (column: number) => [0, 0, column, 0, 65, 16, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, formula.length, 0, ...formula];
  const c = context(), limited = { ...c, limits: { ...c.limits, operations: 3 } };
  const book = await readPln(pln(cell(0)), limited);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=1+2");
  await expect(readPln(pln([...cell(0), ...cell(1)]), limited)).rejects.toThrow("operations limit exceeded");
});
