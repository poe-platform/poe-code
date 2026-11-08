import { expect, it, vi } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createOdfWriter, readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
const bounds = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };

function workbook(formula = '="Sales"', dirty = false): Workbook {
  return { automaticLabelLookup: false, sheets: [{ id: "s", name: "Data", cells: [
    { row: 0, column: 0, formula, formulaDirty: dirty, value: { kind: "string", value: "Sales" },
      cachedResult: { kind: "string", value: "Sales" } },
    { row: 1, column: 0, value: { kind: "number", value: 2 } },
    { row: 4, column: 0, value: { kind: "number", value: 3 } },
    { row: 7, column: 5, formula: "=SUM(@column.odf.quoted:A$1)", formulaDirty: true, value: { kind: "number", value: 999 } }
  ], labelRanges: [{ axis: "column", labels: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    data: { startRow: 1, endRow: 4, startColumn: 0, endColumn: 0 } }] }] };
}

async function content(bytes: Uint8Array): Promise<string> {
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, bounds, context.signal);
  const entry = archive.entries.find(entry => entry.name === "content.xml")!;
  const chunks: Uint8Array[] = [];
  for await (const chunk of zip.decodeZipEntry(entry, bounds, context.signal)) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

it.each(["strict", "extended"] as const)("exports a %s formula-generated label with its captured anchor", async profile => {
  const bytes = await createOdfWriter(profile)(workbook(), [], context);
  expect(await content(bytes)).toContain('table:formula="of:=SUM(\'Sales\')"');
  const reopened = await readOdf(bytes, context);
  expect(reopened.sheets[0]!.cells.find(cell => cell.row === 7)?.formula).toBe("=SUM(@column.odf.quoted:A$1)");
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.find(cell => cell.row === 7)?.value)
    .toEqual({ kind: "number", value: 5 });
});

it("refreshes dirty label text and exports the same refreshed cell cache without changing its input", async () => {
  const original = workbook('="New Sales"', true), before = structuredClone(original);
  const bytes = await createOdfWriter("strict")(original, [], context);
  expect(await content(bytes)).toContain('table:formula="of:=SUM(\'New Sales\')"');
  const reopened = await readOdf(bytes, context);
  expect(reopened.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "string", value: "New Sales" });
  expect(reopened.sheets[0]!.cells.find(cell => cell.row === 7)?.formula).toBe("=SUM(@column.odf.quoted:A$1)");
  expect(original).toEqual(before);
});

it("evaluates label dependencies without calling an unrelated dirty external formula", async () => {
  const original = workbook('=B1&" Sales"', true), sheet = original.sheets[0]!;
  const resolve = vi.fn(() => ({ kind: "string" as const, value: "unexpected" }));
  const input: Workbook = { ...original, sheets: [{ ...sheet, cells: [...sheet.cells,
    { row: 0, column: 1, formula: '="New"', formulaDirty: true, value: { kind: "string", value: "Old" } },
    { row: 9, column: 9, formula: "=[remote]Title", formulaDirty: true, value: { kind: "number", value: 17 } }
  ] }] };
  const bytes = await createOdfWriter("strict")(input, [], { ...context, externalReferences: { resolve } });
  expect(await content(bytes)).toContain('table:formula="of:=SUM(\'New Sales\')"');
  expect(resolve).not.toHaveBeenCalled();
  const reopened = await readOdf(bytes, context);
  expect(reopened.sheets[0]!.cells.find(cell => cell.row === 9)?.cachedResult).toEqual({ kind: "number", value: 17 });
});

it.each([false, true])("keeps clean or manual cached label results (manual=%s)", async manual => {
  const resolve = vi.fn(() => ({ kind: "string" as const, value: "New Sales" }));
  const input = { ...workbook("=[remote]Title", manual), ...(manual ? { calculationMode: "manual" as const } : {}) };
  const bytes = await createOdfWriter("strict")(input, [], { ...context, externalReferences: { resolve } });
  expect(await content(bytes)).toContain('table:formula="of:=SUM(\'Sales\')"');
  expect(resolve).not.toHaveBeenCalled();
});

it("rejects a label whose recalculated text becomes numeric", async () => {
  await expect(createOdfWriter("strict")(workbook("=42", true), [], context))
    .rejects.toMatchObject({ code: "unsupported-feature" });
});

it("checks refreshed competing formula labels before publishing a spelling", async () => {
  const original = workbook('="Sales"', true), sheet = original.sheets[0]!;
  const input: Workbook = { ...original, sheets: [{ ...sheet,
    labelRanges: sheet.labelRanges!.map(pair => ({ ...pair, labels: { ...pair.labels, endColumn: 2 }, data: { ...pair.data, endColumn: 2 } })),
    cells: [...sheet.cells.map(cell => cell.row === 7 ? { ...cell, formula: "=SUM(@column.odf.quoted:C$1)" } : cell),
      { row: 0, column: 2, formula: '="Sales"', formulaDirty: true, value: { kind: "string", value: "Other" } }]
  }] };
  await expect(createOdfWriter("strict")(input, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it("preserves cancellation from the explicitly supplied label dependency host", async () => {
  const controller = new AbortController(), reason = { cancelled: "label" };
  const resolve = vi.fn(() => { controller.abort(reason); return { kind: "string" as const, value: "Sales" }; });
  await expect(createOdfWriter("strict")(workbook("=[remote]Title", true), [], {
    ...context, signal: controller.signal, externalReferences: { resolve }
  })).rejects.toBe(reason);
  expect(resolve).toHaveBeenCalledOnce();
});

it("captures a textual label before its formula changes that label's spelling", async () => {
  const original = workbook('="New Sales"', true), sheet = original.sheets[0]!;
  const input = { ...original, sheets: [{ ...sheet, cells: sheet.cells.map(cell => cell.row === 7 ?
    { ...cell, formula: "of:=SUM('Sales')" } : cell) }] };
  const bytes = await createOdfWriter("strict")(input, [], context);
  expect(await content(bytes)).toContain('table:formula="of:=SUM(\'New Sales\')"');
  expect((await readOdf(bytes, context)).sheets[0]!.cells.find(cell => cell.row === 7)?.formula)
    .toBe("=SUM(@column.odf.quoted:A$1)");
});

it("uses the formula result cache consistently when the raw cell value differs", async () => {
  const original = workbook(), sheet = original.sheets[0]!;
  const input: Workbook = { ...original, sheets: [{ ...sheet, cells: sheet.cells.map(cell => cell.row === 0 ?
    { ...cell, value: { kind: "number", value: 42 } } : cell) }] };
  const bytes = await createOdfWriter("strict")(input, [], context);
  expect(await content(bytes)).toContain('table:formula="of:=SUM(\'Sales\')"');
  expect((await readOdf(bytes, context)).sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "string", value: "Sales" });
});

it("settles a shared explicit-host dependency once for multiple label formulas", async () => {
  const original = workbook('=B10&" One"', true), sheet = original.sheets[0]!;
  const input: Workbook = { ...original, sheets: [{ ...sheet,
    labelRanges: sheet.labelRanges!.map(pair => ({ ...pair, labels: { ...pair.labels, endColumn: 2 }, data: { ...pair.data, endColumn: 2 } })),
    cells: [...sheet.cells,
      { row: 0, column: 2, formula: '=B10&" Two"', formulaDirty: true, value: { kind: "string", value: "Other" } },
      { row: 7, column: 6, formula: "=SUM(@column.odf.quoted:C$1)", value: { kind: "number", value: 999 } },
      { row: 9, column: 1, formula: "=[remote]Title", formulaDirty: true, value: { kind: "string", value: "Old" } }]
  }] };
  const resolve = vi.fn(() => ({ kind: "string" as const, value: "New" }));
  const bytes = await createOdfWriter("strict")(input, [], { ...context, externalReferences: { resolve } });
  const xml = await content(bytes);
  expect(xml).toContain('table:formula="of:=SUM(\'New One\')"');
  expect(xml).toContain('table:formula="of:=SUM(\'New Two\')"');
  expect(resolve).toHaveBeenCalledOnce();
});

it("refreshes a dirty matrix label even in manual calculation mode", async () => {
  const original = workbook('={"New Sales"}', true), sheet = original.sheets[0]!;
  const input: Workbook = { ...original, calculationMode: "manual", sheets: [{ ...sheet,
    cells: sheet.cells.map(cell => cell.row === 0 ? { ...cell, formulaGroup: "label" } : cell),
    formulaGroups: [{ id: "label", kind: "array", expression: '={"New Sales"}',
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }]
  }] };
  const bytes = await createOdfWriter("strict")(input, [], context);
  expect(await content(bytes)).toContain('table:formula="of:=SUM(\'New Sales\')"');
});

it("charges label parsing and dependency work to the enclosing export budget", async () => {
  await expect(createOdfWriter("strict")(workbook('="New Sales"', true), [], {
    ...context, limits: { ...context.limits, workbookWork: 20 }
  })).rejects.toMatchObject({ code: "resource-limit" });
});

it("does not publish a dirty circular label formula's old string as a refreshed result", async () => {
  await expect(createOdfWriter("strict")(workbook("=A1", true), [], context))
    .rejects.toMatchObject({ code: "unsupported-feature" });
});

it("binds textual labels using the same clean formula cache that is written to ODF", async () => {
  const original = workbook(), sheet = original.sheets[0]!;
  const input: Workbook = { ...original, sheets: [{ ...sheet, cells: sheet.cells.map(cell => cell.row === 0 ?
    { ...cell, value: { kind: "number", value: 42 } } : cell.row === 7 ? { ...cell, formula: "of:=SUM('Sales')" } : cell) }] };
  const bytes = await createOdfWriter("strict")(input, [], context);
  expect((await readOdf(bytes, context)).sheets[0]!.cells.find(cell => cell.row === 7)?.formula)
    .toBe("=SUM(@column.odf.quoted:A$1)");
});
