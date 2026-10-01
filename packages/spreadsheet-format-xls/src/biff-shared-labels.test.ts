import { expect, test } from "vitest";
import { readBiff, createBiffWriter } from "./biff.js";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
function record(opcode: number, data: readonly number[]): number[] {
  return [opcode & 255, opcode >> 8, data.length & 255, data.length >> 8, ...data];
}
function formula(row: number, tokens: number[]): number[] {
  const data = new Uint8Array(22), view = new DataView(data.buffer);
  view.setUint16(0, row, true); view.setUint16(2, 3, true);
  view.setFloat64(6, row === 2 ? 60 : 300, true);
  view.setUint16(20, tokens.length, true);
  return record(6, [...data, ...tokens]);
}
function workbook(tokens: number[], kind: "shared" | "array" | "cell"): Uint8Array {
  const bytes = record(0x809, [0, 6, 16, 0]);
  const pointer = [1, 2, 0, 3, 0];
  bytes.push(...formula(2, kind === "cell" ? tokens : pointer));
  if (kind !== "cell") {
    const header = new Uint8Array(kind === "shared" ? 10 : 14);
    header.set([2, 0, 3, 0, 3, 3]);
    if (kind === "shared") header[7] = 2;
    new DataView(header.buffer).setUint16(header.length - 2, tokens.length, true);
    bytes.push(...record(kind === "shared" ? 0x4bc : 0x221, [...header, ...tokens]), ...formula(3, pointer));
  }
  return Uint8Array.from([...bytes, ...record(10, [])]);
}

// MS-XLS 2.5.198.118 forbids ELF in SharedParsedFormula; it is legal in
// CellParsedFormula and ArrayParsedFormula. Relative flags do not relax this.
for (const subtype of [2, 3, 6, 7]) for (const flags of [0, 0x40, 0x80, 0xc0]) {
  const tokens = [0x18, subtype, 2, 0, 0, flags, 0x22, 1, 4, 0];
  test(`rejects SHRFMLA label subtype ${subtype} with flags ${flags}`, async () => {
    await expect(readBiff(workbook(tokens, "shared"), context)).rejects.toMatchObject({
      code: "io", message: expect.stringContaining("ELF label in shared formula")
    });
  });
  test(`retains cell and array label subtype ${subtype} with flags ${flags}`, async () => {
    for (const kind of ["cell", "array"] as const) {
      const book = await readBiff(workbook(tokens, kind), context);
      const output = await createBiffWriter(8)(book, [], context);
      const restored = await readBiff(output, context);
      expect(restored.sheets[0]!.cells.map(cell => [cell.formula, cell.value]))
        .toEqual(book.sheets[0]!.cells.map(cell => [cell.formula, cell.value]));
    }
  });
}
