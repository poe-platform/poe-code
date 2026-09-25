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
function workbook(raw: number, mode: "missing" | "inactive" | "active", namespace = 0, index = 1, flags = 0, name = "Rate"): Uint8Array {
  const token = new Uint8Array([raw, namespace, 0, index, 0, 0, 0, 0x1e, 1, 0, 3]);
  const cell = new Uint8Array(22 + token.length), cellView = new DataView(cell.buffer);
  cellView.setFloat64(6, 999, true); cellView.setUint16(20, token.length, true); cell.set(token, 22);
  const spelling = new TextEncoder().encode(name);
  const nameHeader = new Uint8Array(14); nameHeader[3] = spelling.length; nameHeader[4] = 2;
  const globalName = record(0x18, join(nameHeader, new Uint8Array([0]), spelling, new Uint8Array([0x1c, 29])));
  const externalName = record(0x23, join(new Uint8Array([flags, 0, 0, 0, 0, 0, spelling.length, 0]), spelling,
    new Uint8Array([7, 0, 0x1e, 2, 0, 0x1e, 3, 0, 3])));
  const externalBook = record(0x1ae, new Uint8Array([1, 0, 9, 0, 0, 1, 98, 111, 111, 107, 46, 120, 108, 115, 5, 0, 0, 79, 116, 104, 101, 114]));
  const bound = new Uint8Array([0, 0, 0, 0, 0, 0, 4, 0, 72, 101, 114, 101]);
  const globals = [bof(5), record(0x85, bound), ...(mode === "active" ? [globalName] : []), externalBook,
    ...(mode === "missing" ? [] : [externalName]), externalBook,
    record(0x17, new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0])), record(10)];
  new DataView(globals[1]!.buffer).setUint32(4, globals.reduce((size, part) => size + part.length, 0), true);
  return join(...globals, bof(16), record(6, cell), record(10));
}

// Gnumeric 1.12.61 binds these names to local placeholders. Preserve external
// identity instead: only an explicit external-reference host may supply values.
it.each(["missing", "inactive", "active"] as const)("recalculates BIFF8 %s external names in every token class", async mode => {
  for (const raw of [0x39, 0x59, 0x79]) {
    const input = workbook(raw, mode), before = input.slice();
    const diagnostics: string[] = []; let resolutions = 0;
    const book = await readBiff(input, { ...context,
      externalReferences: { resolve() { resolutions++; throw new Error("implicit external access"); } },
      async diagnostic(d) { diagnostics.push(d.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBe(mode === "missing" ? "=#REF!+1" : "=['book.xls']Rate+1");
    expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 999 });
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
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
  expect(book.names).toEqual([{ name: "Sheet_Title", expression: '="Here"', sheet: "Here" },
    { name: "Print_Area", expression: "=#REF!", sheet: "Here" }]);
});

it.each(["Sheet_Title", "Print_Area"])("keeps external %s names distinct from implicit sheet names", async name => {
  const book = await readBiff(workbook(0x39, "active", 0, 1, 0, name), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
  expect(recalculateWorkbook(book, { ...context, externalReferences: { resolve(request) {
    expect(request).toMatchObject({ kind: "name", workbook: "book.xls", name });
    return { kind: "number", value: 5 };
  } } }, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 6 });
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
  // Native teardown removes the untouched NAME placeholder. The unsupported
  // EXTERNNAME is still retained without evaluating its body.
  expect(book.names).toEqual([{ name: "Sheet_Title", expression: '="Here"', sheet: "Here" },
    { name: "Print_Area", expression: "=#REF!", sheet: "Here" }]);
  expect(book.unsupportedRecords?.find(record => record.kind === "EXTERNNAME_v0")?.data)
    .toMatchObject({ opcode: 0x23, bytes: "02000000000004005261746507001e02001e030003" });
});
