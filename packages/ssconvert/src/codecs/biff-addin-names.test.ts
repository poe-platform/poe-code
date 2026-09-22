import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function token(revision: number, namespace = 0, index = 1, raw = 0x39): Uint8Array {
  const bytes = new Uint8Array(revision === 8 ? 7 : 25), view = new DataView(bytes.buffer);
  bytes[0] = raw; view.setUint16(1, revision === 8 ? namespace : namespace + 1, true);
  view.setUint16(revision === 8 ? 3 : 11, index, true); return bytes;
}
function formulaContext(revision: number) {
  return { revision, row: 0, column: 0, codepage: 1252, names: ["Rate"], nameSheets: [undefined],
    externalSheets: [undefined], externalNames: [[{ name: "GAMMA", expression: "=#REF!" }]], limit: 1000 };
}
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
it.each([7, 8])("binds BIFF%i add-in NameX in every token class independently of workbook names", revision => {
  for (const raw of [0x39, 0x59, 0x79]) {
    expect(translateBiffFormula(token(revision, 0, 1, raw), formulaContext(revision))).toBe("=(#REF!)");
    expect(translateBiffFormula(join(token(revision, 0, 1, raw), new Uint8Array([0x1e, 5, 0, 0x42, 2, 255, 0])), formulaContext(revision))).toBe("=GAMMA(5)");
  }
});
it.each([7, 8])("bounds BIFF%i add-in namespace/index/payload and charges expanded expressions", revision => {
  expect(translateBiffFormula(token(revision, 0, 0), formulaContext(revision))).toBe("=#REF!");
  expect(translateBiffFormula(token(revision, 0, 2), formulaContext(revision))).toBe("=#REF!");
  expect(() => translateBiffFormula(token(revision, 1), formulaContext(revision))).toThrow("external BIFF workbook reference");
  const bytes = token(revision);
  expect(() => translateBiffFormula(bytes.subarray(0, bytes.length - 1), formulaContext(revision))).toThrow("Invalid Excel BIFF");
  expect(() => translateBiffFormula(bytes, { ...formulaContext(revision), limit: 5 })).toThrow("work limit");
  expect(() => translateBiffFormula(bytes, { ...formulaContext(revision), externalNames: [[{ name: "DDE" }]] })).toThrow("external BIFF name expression");
});
it("preserves a private declaration's expression despite a colliding workbook name", () => {
  expect(translateBiffFormula(token(8), { ...formulaContext(8), externalNames: [[{ name: "Rate", expression: "=#REF!" }]] })).toBe("=(#REF!)");
});
function record(opcode: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
}
const bof = (revision: number, type: number) => record(0x809, new Uint8Array([0, revision === 8 ? 6 : 5, type, 0]));
function externalName(revision: number, name: string, tokens = new Uint8Array([0x1c, 23])): Uint8Array {
  return record(0x23, join(new Uint8Array(6), new Uint8Array([name.length, ...(revision === 8 ? [0] : [])]),
    new TextEncoder().encode(name), new Uint8Array([tokens.length, 0]), tokens));
}
function formula(tokens: Uint8Array): Uint8Array {
  const payload = new Uint8Array(22 + tokens.length), view = new DataView(payload.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true); payload.set(tokens, 22); return record(6, payload);
}
it.each([7, 8])("uses the actual BIFF%i add-in declaration owner through original import and recalculation", async revision => {
  const declared = externalName(revision, "GAMMA"), tokens = join(token(revision, revision === 8 ? 1 : 0), new Uint8Array([0x1e, 5, 0, 0x42, 2, 255, 0]));
  const global = revision === 8 ? [record(0x1ae, new Uint8Array([1, 0, 1, 0x3a])), externalName(8, "SUM"),
    record(0x1ae, new Uint8Array([1, 0, 1, 0x3a])), declared, record(0x17, new Uint8Array([2, 0, 0, 0, 0xfe, 0xff, 0xfe, 0xff, 1, 0, 0xfe, 0xff, 0xfe, 0xff]))] :
    [record(0x17, new Uint8Array([1, 0x3a])), externalName(7, "SUM")];
  const local = revision === 7 ? [record(0x17, new Uint8Array([1, 0x3a])), declared] : [];
  const diagnostics: string[] = [];
  const book = await readBiff(join(bof(revision, 5), ...global, record(10), bof(revision, 16), ...local, formula(tokens), record(10)),
    { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=GAMMA(5)");
  expect(diagnostics).toEqual([]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 24 });
});
it.each([7, 8] as const)("reopens writer-emitted BIFF%i add-in functions without native plugins", async revision => {
  const book: Workbook = { sheets: [{ id: "s", name: "Here", cells: [{ row: 0, column: 0, formula: "=GAMMA(5)", value: { kind: "number", value: 999 } }] }] };
  const diagnostics: string[] = [];
  const reopened = await readBiff(await createBiffWriter(revision)(book, [], context), { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(reopened.sheets[0]!.cells[0]!.formula).toBe("=GAMMA(5)");
  expect(diagnostics).toEqual([]);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 24 });
});
it.each([7, 8].flatMap(revision => ["inactive-expression", "inactive-placeholder", "active-placeholder"].map(mode => ({ revision, mode }))))("preserves BIFF$revision $mode name activity", async ({ revision, mode }) => {
  const active = mode === "active-placeholder", body = mode === "inactive-placeholder" ? new Uint8Array() : new Uint8Array([0x1e, 2, 0, 0x1e, 3, 0, 3]);
  const header = new Uint8Array(14); header[3] = 4; header[4] = 2;
  const globalName = active ? [record(0x18, join(header, new Uint8Array(revision === 8 ? [0] : []), new TextEncoder().encode("Rate"), new Uint8Array([0x1c, 29])))] : [];
  const declared = externalName(revision, "Rate", body);
  const globals = revision === 8 ? [record(0x1ae, new Uint8Array([1, 0, 1, 0x3a])), declared,
    record(0x17, new Uint8Array([1, 0, 0, 0, 0xfe, 0xff, 0xfe, 0xff]))] : [];
  const local = revision === 7 ? [record(0x17, new Uint8Array([1, 0x3a])), declared] : [];
  const imported = await readBiff(join(bof(revision, 5), ...globalName, ...globals, record(10), bof(revision, 16), ...local, formula(token(revision)), record(10)), context);
  expect(recalculateWorkbook(imported, context, true).sheets[0]!.cells[0]!.value).toEqual(active ? { kind: "number", value: 5 } : { kind: "error", value: "#REF!" });
  if (active) expect(imported.names).toEqual([{ name: "Rate", expression: "=2+3" }]);
  const diagnostics: string[] = [];
  const reopened = await readBiff(await createBiffWriter(revision as 7 | 8)(imported, [], { ...context, async diagnostic(value) { diagnostics.push(value.message); } }), context);
  expect(diagnostics).toEqual([]);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual(active ? { kind: "number", value: 5 } : { kind: "error", value: "#REF!" });
});
