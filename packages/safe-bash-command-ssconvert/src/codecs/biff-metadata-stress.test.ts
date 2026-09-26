import { expect, it } from "vitest";
import { readBiff } from "./biff.js";
import { Binary, type BiffRecord } from "./biff-binary.js";
import { readBiffMetadata } from "./biff-metadata.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };
function record(opcode: number, payload: readonly number[] | Uint8Array = []): BiffRecord {
  return { opcode, offset: 0, data: new Binary(new Uint8Array(payload)) };
}
function fixture(...records: BiffRecord[]): Uint8Array {
  return new Uint8Array(records.flatMap(({ opcode, data }) => [opcode & 255, opcode >> 8,
    data.bytes.length & 255, data.bytes.length >> 8, ...data.bytes]));
}
function note(text: Uint8Array, total: number, continuation = false): BiffRecord {
  const bytes = new Uint8Array(6 + text.length), view = new DataView(bytes.buffer);
  view.setUint16(0, continuation ? 0xffff : 0, true); view.setUint16(4, total, true); bytes.set(text, 6);
  return record(0x1c, bytes);
}
it("reads every original legacy NOTE continuation rather than rejecting the third chunk", () => {
  const result = readBiffMetadata([note(new Uint8Array(2048).fill(65), 4097),
    note(new Uint8Array(2048).fill(66), 0, true), note(new Uint8Array([67]), 0, true)], 7, 1252, context);
  expect(JSON.stringify(result.records)).toContain("A".repeat(2048) + "B".repeat(2048) + "C");
});
it("rejects legacy NOTE continuations with nonzero columns", () => {
  const continuation = note(new Uint8Array([66]), 0, true); continuation.data.bytes[2] = 1;
  expect(() => readBiffMetadata([note(new Uint8Array(2048).fill(65), 2049), continuation], 7, 1252, context)).toThrow("NOTE continuation");
});
it("bounds total metadata comment text across separate NOTE records", () => {
  expect(() => readBiffMetadata([note(new Uint8Array([65, 65]), 2), note(new Uint8Array([66, 66]), 2)], 7, 1252,
    { ...context, limits: { ...context.limits, workbookTextBytes: 3 } })).toThrow("text limit");
});
it("accepts an empty BIFF8 author without reading nonexistent Unicode flags", () => {
  const result = readBiffMetadata([record(0x1c, [0, 0, 0, 0, 0, 0, 1, 0, 0, 0])], 8, 1252, context);
  expect(JSON.stringify(result.records)).toContain('"name":"Author","namespace":"","value":""');
});
it("ignores zero-payload headers and accepts explicit empty headers", async () => {
  for (const payload of [[], [0, 0]]) {
    const book = await readBiff(fixture(record(0x809, [0, 6, 16, 0]), record(0x14, payload), record(10)), context);
    expect(book.sheets).toHaveLength(1);
  }
});
it("rejects nonfinite print setup header/footer margins", () => {
  const bytes = new Uint8Array(34); new DataView(bytes.buffer).setFloat64(16, Number.NaN, true);
  expect(() => readBiffMetadata([record(0xa1, bytes)], 8, 1252, context)).toThrow("print margin");
});
it("links TXO text by OBJ id and joins compressed/wide CONTINUE characters", () => {
  const txo = new Uint8Array(18); new DataView(txo.buffer).setUint16(10, 2, true);
  const result = readBiffMetadata([record(0x5d, [0x15, 0, 6, 0, 0x19, 0, 7, 0, 0, 0, 0, 0, 0, 0]), record(0x1b6, txo),
    record(0x3c, [0, 65]), record(0x3c, [1, 0xa9, 3]), record(0x1c, [1, 0, 2, 0, 0, 0, 7, 0, 1, 0, 0, 90])], 8, 1252, context);
  expect(JSON.stringify(result.records)).toContain('"value":"AΩ"');
  expect(JSON.stringify(result.records)).toContain('"value":"Z"');
  expect(JSON.stringify(result.records)).toContain('"value":"C2"');
});
it("does not attach an unowned later TXO to the previous comment object", () => {
  const txo = new Uint8Array(18); new DataView(txo.buffer).setUint16(10, 1, true);
  const result = readBiffMetadata([record(0x5d, [0x15, 0, 6, 0, 0x19, 0, 7, 0, 0, 0]), record(0x1b6, txo), record(0x3c, [0, 65]),
    record(0x5d, [0, 0, 0, 0]), record(0x1b6, txo), record(0x3c, [0, 66]), record(0x1c, [0, 0, 0, 0, 0, 0, 7, 0, 0, 0])], 8, 1252, context);
  expect(JSON.stringify(result.records)).toContain('"name":"Text","namespace":"","value":"A"');
});
it("observes cancellation before legacy continuation decoding", () => {
  const controller = new AbortController(), reason = new Error("cancel metadata"); controller.abort(reason);
  expect(() => readBiffMetadata([note(new Uint8Array([65]), 1)], 7, 1252, { ...context, signal: controller.signal })).toThrow(reason);
});
it("retains unknown shape/chart bytes and orders their warnings without inventing comments", async () => {
  const warnings: string[] = [];
  const book = await readBiff(fixture(record(0x809, [0, 6, 16, 0]), record(0xec, [17, 34]), record(0x1002, [51, 68]), record(10)),
    { ...context, async diagnostic(diagnostic) { warnings.push(diagnostic.message); } });
  expect(book.sheets[0]!.unsupportedRecords?.map(record => (record.data as { bytes: string }).bytes)).toEqual(["1122", "3344"]);
  expect(warnings).toHaveLength(2);
  expect(book.sheets[0]!.unsupportedRecords?.some(record => record.kind === "Objects")).toBe(false);
});
