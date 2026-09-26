import { expect, it } from "vitest";
import { goalSeekRange } from "./goal-seek.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  limits: { cells: 100, sheets: 4, operations: 20, inputBytes: 10000, outputBytes: 10000 },
  environment: { env: {}, locale: "C", timezone: "UTC" } };
const range = { sheet: "s", startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 };

it("evaluates only the target closure and preserves unrelated manual caches", async () => {
  const book: Workbook = { calculationMode: "manual", sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: "=B1*2", value: { kind: "number", value: 2 } },
    { row: 0, column: 1, value: { kind: "number", value: 1 } },
    { row: 0, column: 2, value: { kind: "number", value: 8 } },
    { row: 0, column: 5, formula: "=RAND()", value: { kind: "number", value: .25 }, cachedResult: { kind: "number", value: .25 } },
    { row: 0, column: 6, formula: "=B1*3", value: { kind: "number", value: 3 } }
  ] }] };
  const result = await goalSeekRange(book, range, context);
  expect(result.sheets[0]!.cells.find(c => c.column === 1)!.value).toEqual({ kind: "number", value: 4 });
  expect(result.sheets[0]!.cells.find(c => c.column === 5)).toEqual(book.sheets[0]!.cells[3]);
  expect(result.sheets[0]!.cells.find(c => c.column === 6)).toMatchObject({ value: { kind: "number", value: 3 }, formulaDirty: true });
});

it("charges repeated target evaluation against one goal seek work budget", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: "=B1^2", value: { kind: "number", value: 1 } },
    { row: 0, column: 1, value: { kind: "number", value: 1 } },
    { row: 0, column: 2, value: { kind: "number", value: 2 } }
  ] }] };
  await expect(goalSeekRange(book, range, { ...context, limits: { ...context.limits, workbookWork: 100 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
});

it("requires an injected random source when deterministic search fails", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 } },
    { row: 0, column: 1, value: { kind: "number", value: 0 } },
    { row: 0, column: 2, value: { kind: "number", value: 0 } },
    { row: 0, column: 3, value: { kind: "number", value: -1 } },
    { row: 0, column: 4, value: { kind: "number", value: 1 } }
  ] }] };
  await expect(goalSeekRange(book, range, context)).rejects.toMatchObject({ code: "capability-denied" });
});

it.each([
  ["=EXP(B1)", 0, 3, -10, 10, 1.0986122886681096],
  ["=SIN(B1)", 3, 0, 2, 4, 3.141592653589794]
] as const)("matches independently measured difficult root %s", async (formula, initial, target, minimum, maximum, root) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, value: { kind: "number", value: 0 } },
    ...[initial, target, minimum, maximum].map((value, index) => ({ row: 0, column: index + 1, value: { kind: "number" as const, value } }))
  ] }] };
  const result = await goalSeekRange(book, range, context);
  expect(result.sheets[0]!.cells.find(c => c.column === 1)!.value).toEqual({ kind: "number", value: root });
});

it.each([
  [{ kind: "string", value: " 8tail" }, 4],
  [{ kind: "boolean", value: true }, .5],
  [{ kind: "error", value: "#N/A" }, 0]
] as const)("coerces raw target %j without formatted entry parsing", async (target, root) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: "=B1*2", value: { kind: "number", value: 0 } },
    { row: 0, column: 1, value: { kind: "number", value: 1 } },
    { row: 0, column: 2, value: target }
  ] }] };
  const result = await goalSeekRange(book, range, context);
  expect(result.sheets[0]!.cells.find(c => c.column === 1)!.value).toEqual({ kind: "number", value: root });
});

it("checks cancellation before changing input or drawing random values", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled goal seek"));
  await expect(goalSeekRange({ sheets: [{ id: "s", name: "Sheet", cells: [] }] }, range,
    { ...context, signal: controller.signal })).rejects.toThrow("cancelled goal seek");
});
