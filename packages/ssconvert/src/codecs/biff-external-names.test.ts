import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff } from "./biff.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
function record(opcode: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4); return bytes;
}
function bof(type: number): Uint8Array {
  const payload = new Uint8Array(16), view = new DataView(payload.buffer);
  view.setUint16(0, 0x600, true); view.setUint16(2, type, true);
  view.setUint16(4, 0xdbb, true); view.setUint16(6, 1997, true); return record(0x809, payload);
}
function workbook(raw: number, mode: "missing" | "inactive" | "active", namespace = 0, index = 1, flags = 0): Uint8Array {
  const token = new Uint8Array([raw, namespace, 0, index, 0, 0, 0, 0x1e, 1, 0, 3]);
  const cell = new Uint8Array(22 + token.length), cellView = new DataView(cell.buffer);
  cellView.setFloat64(6, 999, true); cellView.setUint16(20, token.length, true); cell.set(token, 22);
  const nameHeader = new Uint8Array(14); nameHeader[3] = 4; nameHeader[4] = 2;
  const globalName = record(0x18, join(nameHeader, new Uint8Array([0, 82, 97, 116, 101, 0x1c, 29])));
  const externalName = record(0x23, new Uint8Array([flags, 0, 0, 0, 0, 0, 4, 0, 82, 97, 116, 101, 7, 0, 0x1e, 2, 0, 0x1e, 3, 0, 3]));
  const externalBook = record(0x1ae, new Uint8Array([1, 0, 9, 0, 0, 1, 98, 111, 111, 107, 46, 120, 108, 115, 5, 0, 0, 79, 116, 104, 101, 114]));
  const bound = new Uint8Array([0, 0, 0, 0, 0, 0, 4, 0, 72, 101, 114, 101]);
  const globals = [bof(5), record(0x85, bound), ...(mode === "active" ? [globalName] : []), externalBook,
    ...(mode === "missing" ? [] : [externalName]), externalBook,
    record(0x17, new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0])), record(10)];
  new DataView(globals[1]!.buffer).setUint32(4, globals.reduce((size, part) => size + part.length, 0), true);
  return join(...globals, bof(16), record(6, cell), record(10));
}

// Gnumeric1.12.61 ms-formula-read.c:1710-1793 binds nonlocal SUPBOOK NameX
// through its own EXTERNNAME table. These are source-derived memory fixtures.
it.each(["missing", "inactive", "active"] as const)("recalculates BIFF8 %s external names in every token class", async mode => {
  for (const raw of [0x39, 0x59, 0x79]) {
    const input = workbook(raw, mode), before = input.slice();
    const diagnostics: string[] = []; let resolutions = 0;
    const book = await readBiff(input, { ...context,
      externalReferences: { resolve() { resolutions++; throw new Error("implicit external access"); } },
      async diagnostic(d) { diagnostics.push(d.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBe(mode === "active" ? "=(Rate)+1" : mode === "inactive" ? "=(#REF!)+1" : "=#REF!+1");
    expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 999 });
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual(mode === "active" ? { kind: "number", value: 6 } : { kind: "error", value: "#REF!" });
    expect(resolutions).toBe(0);
    expect(input).toEqual(before);
    expect(diagnostics.some(message => message.includes("external BIFF workbook reference"))).toBe(false);
    expect(book.unsupportedRecords?.filter(record => record.kind === "SUPBOOK")).toHaveLength(2);
    if (mode !== "missing") expect(book.unsupportedRecords?.find(record => record.kind === "EXTERNNAME_v0")?.data).toMatchObject({
      opcode: 0x23, bytes: "00000000000004005261746507001e02001e030003" });
  }
});

it("keeps external name tables separate from neighboring declarations and workbook names", async () => {
  const book = await readBiff(workbook(0x39, "active", 1), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=#REF!+1");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
  expect(book.names).toEqual([{ name: "Rate", expression: "=2+3" }]);
});

it.each([0, 2])("refuses missing external name index %i without using the cached value", async index => {
  const book = await readBiff(workbook(0x39, "active", 0, index), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
});

it("retains unsupported external declaration flags without interpreting their bodies", async () => {
  const diagnostics: string[] = [];
  const book = await readBiff(workbook(0x39, "active", 0, 1, 2), { ...context, async diagnostic(d) { diagnostics.push(d.message); } });
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(diagnostics.some(message => message.includes("external BIFF name expression"))).toBe(true);
  expect(book.names).toEqual([{ name: "Rate", expression: "=#NAME?" }]);
});
