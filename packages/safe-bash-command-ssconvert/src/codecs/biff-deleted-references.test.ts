import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 1000 } };
function record(opcode: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
}
function formulaContext(revision: number) {
  return { revision, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [], limit: 100 };
}
function deletedToken(revision: number, token: number): Uint8Array {
  const area = (token & 0x1f) === 0x1d;
  // Gnumeric's authenticated token widths: BIFF8 6/10, BIFF7 17/20 payload bytes.
  const bytes = new Uint8Array(1 + (revision === 8 ? area ? 10 : 6 : area ? 20 : 17));
  bytes.fill(0xff); bytes[0] = token; return bytes;
}

it.each([7, 8])("reads BIFF%i RefErr3D/AreaErr3D in every token class and recalculates the error", async revision => {
  for (const token of [0x3c, 0x5c, 0x7c, 0x3d, 0x5d, 0x7d]) {
    const error = deletedToken(revision, token), tokens = new Uint8Array(error.length + 4);
    tokens.set(error); tokens.set([0x1e, 1, 0, 3], error.length);
    expect(translateBiffFormula(tokens, formulaContext(revision))).toBe("=#REF!+1");
    const payload = new Uint8Array(22 + tokens.length);
    new DataView(payload.buffer).setUint16(20, tokens.length, true); payload.set(tokens, 22);
    const parts = [record(0x809, new Uint8Array([0, revision === 8 ? 6 : 5, 16, 0])), record(6, payload), record(10, new Uint8Array())];
    const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const diagnostics: string[] = [];
    const book = await readBiff(bytes, { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBe("=#REF!+1");
    expect(diagnostics).toEqual([]);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
  }
});

it.each([[7, 0x3c], [7, 0x3d], [8, 0x3c], [8, 0x3d]])(
  "rejects truncated BIFF%i deleted-reference token %i", (revision, token) => {
    const bytes = deletedToken(revision, token);
    expect(() => translateBiffFormula(bytes.subarray(0, bytes.length - 1), formulaContext(revision))).toThrow("Invalid Excel BIFF");
  });

it("charges a deleted reference against the existing formula-work limit", () => {
  expect(() => translateBiffFormula(deletedToken(8, 0x3c), { ...formulaContext(8), limit: 4 })).toThrow("work limit");
});
