import { expect, it, vi } from "vitest";
import { readBinary } from "./bytes.js";
import { parseXmlPart } from "./xml.js";
import { Presentation } from "./presentation-model.js";
import { SlideTransferBudget } from "./slide-transfer-budget.js";
import { validateTableUpdate } from "./tables.js";
import { validateShapePath } from "./shape-paths.js";
import { validateChartData } from "./chart-editing.js";
import { resourceContext } from "./resource-limits.js";

it("rejects invalid resource settings and getters before reading them", () => {
  expect(() => resourceContext(null as never)).toThrowError(expect.objectContaining({ code: "invalid-type" }));
  const get = vi.fn(() => 1);
  const limits = Object.defineProperty({}, "maxBytes", { enumerable: true, get });
  expect(() => resourceContext({ limits })).toThrow();
  expect(get).not.toHaveBeenCalled();
});

it("does not inject fixed table, path or chart resource ceilings", () => {
  expect(() => validateTableUpdate({ rows: 250_001, columns: 1, left: { value: 0, unit: "emu" }, top: { value: 0, unit: "emu" }, width: { value: 1, unit: "emu" }, height: { value: 250_001, unit: "emu" } }, true)).not.toThrow();
  expect(() => validateShapePath({ unit: "emu", width: 1, height: 1, commands: Array.from({ length: 4097 }, (_, i) => ({ type: i === 0 ? "move" : "line", x: 0, y: 0 })) })).not.toThrow();
  expect(() => validateChartData({ categoryLevels: Array.from({ length: 65 }, () => ["a"]), series: [{ name: "s", values: [1] }] })).not.toThrow();
});

it("leaves omitted byte and read limits unlimited", async () => {
  let reads = 0;
  const source = { async read() { return ++reads > 8200 ? null : new Uint8Array(); } };
  await expect(readBinary(source, { limits: {} as never })).resolves.toEqual(new Uint8Array());
  await expect(readBinary(new Uint8Array(2), { limits: { maxReads: 1 } as never })).resolves.toHaveLength(2);
  await expect(readBinary(new Uint8Array(2), { limits: { maxBytes: 1 } as never })).rejects.toThrow();
  await expect(readBinary(new Uint8Array(2), { limits: { maxBytes: 1 } as never }, { maxBytes: 2 })).resolves.toHaveLength(2);
});

it("parses XML without hidden defaults and honors individual limits", () => {
  const bytes = new TextEncoder().encode(`${"<r>".repeat(130)}${"</r>".repeat(130)}`);
  expect(parseXmlPart(bytes, {} as never).nodeCount).toBe(130);
  expect(() => parseXmlPart(bytes, { maxDepth: 129 } as never)).toThrow();
});

it("creates presentations and composes transfer budgets with individual limits", async () => {
  const presentation = await Presentation(undefined, { xmlLimits: { maxDepth: 1000 } });
  expect(presentation).toBeDefined();
  const budget = new SlideTransferBudget({ limits: { maxReads: 1 }, archiveLimits: {}, xmlLimits: {}, relationshipLimits: {} } as never);
  await expect(budget.read(new Uint8Array(2))).resolves.toHaveLength(2);
  expect(budget.xml(new TextEncoder().encode("<r/>"))).toBeDefined();
});
