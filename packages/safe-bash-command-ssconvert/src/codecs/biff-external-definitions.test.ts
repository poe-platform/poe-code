import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readBiff } from "./biff.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiffRecords } from "./biff-binary.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function join(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0; for (const part of parts) { output.set(part, at); at += part.length; } return output;
}
function words(...values: number[]): Uint8Array {
  const result = new Uint8Array(values.length * 2), view = new DataView(result.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true)); return result;
}
function record(opcode: number, payload: Uint8Array = new Uint8Array()): Uint8Array { return join(words(opcode, payload.length), payload); }
function text(value: string): Uint8Array { return join(words(value.length), new Uint8Array([0]), new TextEncoder().encode(value)); }
// Native EXTERNNAME formulas use two direct SUPBOOK sheet indexes, unlike cell formulas.
function fixture(definition: Uint8Array, scope = 0): Uint8Array {
  const cell = new Uint8Array(29), view = new DataView(cell.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, 7, true); cell.set([0x59, 0, 0, 1, 0, 0, 0], 22);
  return join(record(0x809, words(0x600, 5)),
    record(0x1ae, join(words(2), text("\u0001book.xls"), text("Unused"), text("Other"))),
    record(0x23, join(words(0, scope, 0), new Uint8Array([4, 0]), new TextEncoder().encode("Rate"), words(definition.length), definition)),
    record(0x17, words(1, 0, 0xfffe, 0xfffe)), record(10),
    record(0x809, words(0x600, 16)), record(6, cell), record(10));
}
for (const area of [false, true]) {
  it(`retains an external name's native ${area ? "area" : "cell"} definition without host access`, async () => {
    const original = join(new Uint8Array([area ? 0x3b : 0x3a]), words(1, 1), area ? words(2, 5, 3, 7) : words(2, 3));
    const host = { ...context, externalReferences: { resolve() { throw new Error("External definition must not execute"); } } };
    const book = await readBiff(fixture(original), host);
    const bytes = await writeBiffStream(book, 8, false, host);
    const records = readBiffRecords(bytes, context);
    const external = records.find(record => record.opcode === 0x23)!;
    const start = 8 + external.data.u8(6) * 2;
    expect(external.data.u16(start)).toBe(original.length);
    expect(external.data.slice(start + 2, original.length)).toEqual(join(new Uint8Array([area ? 0x3b : 0x3a]), words(1, 1), original.subarray(5)));
    expect((await readBiff(bytes, host)).sheets[0]!.cells[0]!.formula).toContain("Rate");
  });
}

it("preserves sheet-span membership after earlier external cell references", async () => {
  const definition = join(new Uint8Array([0x3a]), words(0, 1, 2, 3));
  const book = await readBiff(fixture(definition), context);
  const reordered = { ...book, sheets: [{ ...book.sheets[0]!, cells: [{ row: 1, column: 0, value: { kind: "number" as const, value: 1 }, formula: "=['book.xls']Other!A1" }, ...book.sheets[0]!.cells] }] };
  const records = readBiffRecords(await writeBiffStream(reordered, 8, false, context), context);
  const external = records.find(record => record.opcode === 0x23)!;
  const start = 8 + external.data.u8(6) * 2;
  expect(external.data.slice(start + 2, definition.length)).toEqual(definition);
});

it("preserves error definitions and only suppresses the exported definition loss warning", async () => {
  const book = await readBiff(fixture(new Uint8Array([0x1c, 0x2a])), context);
  const warnings: string[] = [];
  const bytes = await writeBiffStream(book, 8, false, { ...context, diagnostic: async d => { warnings.push(d.message); } });
  const external = readBiffRecords(bytes, context).find(record => record.opcode === 0x23)!;
  const start = 8 + external.data.u8(6) * 2;
  expect(external.data.slice(start, 4)).toEqual(new Uint8Array([2, 0, 0x1c, 0x2a]));
  expect(warnings.some(warning => warning.includes("EXTERNNAME"))).toBe(false);
});

it("rejects conflicting external-name definitions rather than choosing one", async () => {
  const book = await readBiff(fixture(new Uint8Array([0x1c, 0x17])), context);
  const other = await readBiff(fixture(new Uint8Array([0x1c, 0x2a])), context);
  const combined = { ...book, unsupportedRecords: [...book.unsupportedRecords!, ...other.unsupportedRecords!] };
  await expect(writeBiffStream(combined, 8, false, context)).rejects.toThrow("Conflicting retained BIFF external name definitions");
});

it("bounds retained metadata work and observes cancellation", async () => {
  const book = await readBiff(fixture(new Uint8Array([0x1c, 0x17])), context);
  await expect(writeBiffStream(book, 8, false, { ...context, limits: { ...context.limits, workbookWork: 1 } })).rejects.toThrow("work limit");
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(writeBiffStream(book, 8, false, { ...context, signal: controller.signal })).rejects.toThrow("cancelled");
});

it("keeps sheet-scoped definitions distinct from global names", async () => {
  const definition = join(new Uint8Array([0x3a]), words(1, 1, 2, 3));
  const book = await readBiff(fixture(definition, 2), context);
  const records = readBiffRecords(await writeBiffStream(book, 8, false, context), context);
  const external = records.find(record => record.opcode === 0x23)!;
  expect(external.data.u16(2)).toBe(2);
  const start = 8 + external.data.u8(6) * 2;
  expect(external.data.slice(start + 2, definition.length)).toEqual(definition);
});

it("rejects invalid retained sheet indexes before writing a dangling definition", async () => {
  const book = await readBiff(fixture(join(new Uint8Array([0x3a]), words(2, 2, 0, 0))), context);
  await expect(writeBiffStream(book, 8, false, context)).rejects.toThrow("Invalid retained BIFF external name definition");
});
