import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 2000000, outputBytes: 2000000, cells: 5000, sheets: 8, operations: 100000 } };

for (const padding of [0, 256]) it.each([7, 8, "dsf"] as const)(
  `imports BIFF %s cyclic name references with ${padding} preceding names`, async profile => {
    const book: Workbook = { names: [
      ...Array.from({ length: padding }, (_, index) => ({ name: `Padding_${index}`, expression: String(index) })),
      { name: "LoopA", expression: "LoopB" }, { name: "LoopB", expression: "LoopA" },
      { name: "SheetLoopA", sheet: "data", expression: "SheetLoopB" },
      { name: "SheetLoopB", sheet: "data", expression: "SheetLoopA" },
      { name: "SelfGlobal", expression: "SelfGlobal" },
      { name: "SelfLocal", sheet: "data", expression: "SelfLocal" },
      { name: "Guarded", expression: "IF(FALSE,Guarded,7)" },
      { name: "LocalGuarded", sheet: "data", expression: "IF(FALSE,LocalGuarded,11)" },
      { name: "Leaf", expression: "13" }
    ], sheets: [{ id: "here", name: "Here", cells: ["=LoopA", "=LoopB", "=Data!SheetLoopA", "=Data!SheetLoopB",
      "=SelfGlobal", "=Data!SelfLocal", "=Guarded", "=Data!LocalGuarded", "=Leaf", "=IF(FALSE,LoopA,19)"].map((formula, row) =>
      ({ row, column: 0, formula, value: { kind: "number", value: 999 } }))
    }, { id: "data", name: "Data", cells: [] }] };
    const input = await createBiffWriter(profile)(book, [], context), before = new Uint8Array(input);
    const reopened = await readBiff(input, context), calculated = recalculateWorkbook(reopened, context, true);
    expect(calculated.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      ...Array.from({ length: 6 }, () => ({ kind: "error", value: "#REF!" })),
      ...[7, 11, 13, 19].map(value => ({ kind: "number", value }))
    ]);
    expect(reopened.names?.find(name => name.name === "Guarded")?.expression)
      .toBe(padding === 0 ? "=IF(FALSE,#REF!,7)" : "=IF(FALSE,#NAME?,7)");
    expect(reopened.names?.some(name => name.name === (padding === 0 ? "LoopB" : "LoopA"))).toBe(false);
    expect(input).toEqual(before);
  }
);

it.each([7, 8, "dsf"] as const)("removes BIFF %s unknown-name placeholders while retaining guarded constants", async profile => {
  const book: Workbook = { names: [
    { name: "Unknown", expression: "(#NAME?)" },
    { name: "Alias", expression: "Unknown" },
    { name: "Guard", expression: "IF(FALSE,Unknown,17)" }
  ], sheets: [{ id: "here", name: "Here", cells: ["=Unknown", "=Alias", "=Guard"].map((formula, row) =>
    ({ row, column: 0, formula, value: { kind: "number", value: 999 } })) }] };
  const reopened = await readBiff(await createBiffWriter(profile)(book, [], context), context);
  expect(reopened.names?.map(name => name.name)).toEqual(["Alias", "Guard", "Sheet_Title", "Print_Area"]);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "error", value: "#REF!" }, { kind: "error", value: "#REF!" }, { kind: "number", value: 17 }
  ]);
});

it("bounds BIFF name binding work without changing the borrowed input", async () => {
  const book: Workbook = { names: Array.from({ length: 40 }, (_, index) => ({ name: `Bound_${index}`, expression: "1" })),
    sheets: [{ id: "here", name: "Here", cells: [] }] };
  const input = await createBiffWriter(8)(book, [], context), before = new Uint8Array(input);
  await expect(readBiff(input, { ...context, limits: { ...context.limits, workbookWork: 20 } }))
    .rejects.toMatchObject({ code: "resource-limit", message: "ssconvert BIFF name binding work limit exceeded" });
  expect(input).toEqual(before);
});
