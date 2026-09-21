import { expect, it } from "vitest";
import { readBiff } from "./biff.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };
function r(opcode: number, data: Uint8Array | number[] = []): number[] { return [opcode & 255, opcode >> 8, data.length & 255, data.length >> 8, ...data]; }
function formula(row: number): number[] {
  const data = new Uint8Array(27), view = new DataView(data.buffer);
  view.setUint16(0, row, true); view.setFloat64(6, row + 1, true); view.setUint16(20, 5, true); data.set([1, 0, 0, 0, 0], 22);
  return r(6, data);
}
it("resolves shared relative token groups for every dependent cell", async () => {
  const shared = [0, 0, 1, 0, 0, 0, 0, 2, 4, 0, 0x2c, 0, 0, 0, 0xc0];
  // The relative reference occupies one opcode plus four address bytes.
  shared[8] = 5;
  const bytes = new Uint8Array([...r(0x809, [0, 6, 16, 0]), ...formula(0), ...r(0x4bc, shared), ...formula(1), ...r(10)]);
  const book = await readBiff(bytes, context);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["=A1", "=A2"]);
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "shared", expression: "=A1", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 } }]);
});
it("resolves array formulas without treating ptgExp as an unknown cached value", async () => {
  const array = new Uint8Array(17); array.set([0, 0, 1, 0, 0, 0]); array.set([3, 0, 0x1e, 2, 0], 12);
  const bytes = new Uint8Array([...r(0x809, [0, 6, 16, 0]), ...formula(0), ...r(0x221, array), ...formula(1), ...r(10)]);
  const book = await readBiff(bytes, context);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["=2", "=2"]);
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "array", expression: "=2" }]);
});
it.each([2, 3, 4])("reads original revision-%i defined names with revision-specific headers", async revision => {
  const name = revision === 2 ? [0, 0, 0, 1, 3, 88, 0x1e, 7, 0] : [0, 0, 0, 1, 3, 0, 88, 0x1e, 7, 0];
  const book = await readBiff(new Uint8Array([...r(revision === 2 ? 9 : revision === 3 ? 0x209 : 0x409, [0, revision, 16, 0]),
    ...r(0x18, name), ...r(10)]), context);
  expect(book.names).toMatchObject([{ name: "X", expression: "=7" }]);
});
it("interprets legacy self-reference declarations without loss diagnostics", async () => {
  const diagnostics: string[] = [];
  const book = await readBiff(new Uint8Array([...r(0x809, [0, 5, 16, 0]), ...r(0x17, [1, 4]),
    ...r(0x17, [1, 3, 88]), ...r(10)]), { ...context, async diagnostic(d) { diagnostics.push(d.message); } });
  expect(book.sheets).toHaveLength(1); expect(diagnostics).toEqual([]);
});
