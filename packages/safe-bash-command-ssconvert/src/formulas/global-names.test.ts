import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { odfGrammar } from "./conventions.js";
import { recalculateWorkbook } from "./evaluator.js";
import { rewriteReferences } from "./rewriting.js";
import { parseFormula, relocateFormula } from "../workbook/updates/formula.js";
import { createBiffWriter, readBiff } from "../codecs/biff.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const position = { sheet: "Here", row: 0, column: 1 };
function book(formula: string): Workbook {
  return { names: [{ name: "Rate", expression: "=99" }, { name: "Rate", expression: "=20", sheet: "Here" }],
    sheets: [{ id: "Here", name: "Here", cells: [{ row: 0, column: 0, value: { kind: "number", value: 7 } },
      { row: 0, column: 1, formula, value: { kind: "number", value: 999 } }] }] };
}
it("parses and serializes the native current-workbook global namespace", () => {
  const parsed = parseExpression("=[]Rate", { position });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.document.root).toMatchObject({ kind: "name", name: "Rate", workbook: "" });
  expect(serializeExpression(parsed.document, undefined, false)).toBe("=[]Rate");
  expect(() => serializeExpression(parsed.document, odfGrammar, false)).toThrow("global formula name");
});
it("evaluates global and local names independently without invoking external authority", () => {
  const resolve = vi.fn(() => ({ kind: "number" as const, value: 123 }));
  expect(recalculateWorkbook(book("=[]Rate+Rate"), { ...context, externalReferences: { resolve } }, true)
    .sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 119 });
  expect(resolve).not.toHaveBeenCalled();
  expect(recalculateWorkbook(book("=[other]Rate"), { ...context, externalReferences: { resolve } }, true)
    .sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 123 });
  expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ workbook: "other" }), context.signal);
});
it("resolves INDIRECT global ranges through the global namespace", () => {
  const input = { ...book('=SUM(INDIRECT("[]Rate"))'), names: [{ name: "Rate", expression: "=$A$1", position: { sheet: "Here", row: 0, column: 0 } },
    { name: "Rate", expression: "=20", sheet: "Here" }] };
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 7 });
});
it("propagates dirty global precedents despite a colliding sheet-local name", () => {
  const original = book("=[]Rate");
  const input = { ...original, names: [{ name: "Rate", expression: "=$A$1", position: { sheet: "Here", row: 0, column: 0 } },
    { name: "Rate", expression: "=20", sheet: "Here" }], sheets: [{ ...original.sheets[0]!, cells: [
      { row: 0, column: 0, formula: "=8", formulaDirty: true, value: { kind: "number" as const, value: 7 } }, original.sheets[0]!.cells[1]!] }] };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 8 });
});
it("terminates global name cycles locally and respects work limits", () => {
  const input = { ...book("=[]Rate"), names: [{ name: "Rate", expression: "=[]Rate" }, { name: "Rate", expression: "=20", sheet: "Here" }] };
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "error", value: "#NAME?" });
  expect(() => recalculateWorkbook(input, { ...context, limits: { ...context.limits, workbookWork: 1 } }, true)).toThrow("work limit");
});
it("preserves the namespace during workbook formula relocation and local sheet rename", () => {
  const input = book("=[]Rate");
  const parsed = parseFormula("=[]Rate+A1", input, "Here", undefined, position);
  expect(parsed).toBeDefined();
  if (parsed) expect(relocateFormula("=[]Rate+A1", parsed, 1, 0)).toBe("=[]Rate+A2");
  const qualified = parseExpression("=[]Here!Rate", { position });
  expect(qualified.ok).toBe(true);
  if (qualified.ok) expect(rewriteReferences(qualified.document, { sheets: new Map([["Here", "New"]]) })).toBe("='New'!Rate");
});
it.each([7, 8] as const)("preserves the global indexed name through BIFF%i writing and reading", async revision => {
  const reopened = await readBiff(await createBiffWriter(revision)(book("=[]Rate+Rate"), [], context), context);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 119 });
});
