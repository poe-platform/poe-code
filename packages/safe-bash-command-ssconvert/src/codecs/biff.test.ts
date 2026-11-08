import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { createRegistry } from "../codecs.js";
import type { CapabilityContext } from "../contracts.js";
import { readBiff, probeBiff } from "./biff.js";
import { biffDecode } from "./biff-strings.js";

export const biffContext: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };
export function record(opcode: number, bytes: readonly number[] | Uint8Array = []): Uint8Array {
  const result = new Uint8Array(4 + bytes.length), view = new DataView(result.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, bytes.length, true); result.set(bytes, 4); return result;
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
export function numberCell(opcode = 0x203, value = 42): Uint8Array {
  const bytes = new Uint8Array(opcode === 3 ? 15 : 14), view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 2, true); view.setFloat64(opcode === 3 ? 7 : 6, value, true);
  return record(opcode, bytes);
}
it("imports an original BIFF3 worksheet through memfs and the SDK engine", async () => {
  const bytes = concat(record(0x209, [0, 3, 16, 0]), numberCell(), record(10));
  const volume = new Volume(); volume.writeFileSync("/tiny.xls", bytes);
  const engine = createEngine({ codecs: [], environment: biffContext.environment, limits: biffContext.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, data) { volume.writeFileSync(uri, data); } } });
  try {
    expect((await engine.readWorkbook({ kind: "resource", uri: "/tiny.xls" }, {}, biffContext)).sheets[0]?.cells)
      .toMatchObject([{ row: 1, column: 2, value: { kind: "number", value: 42 } }]);
  } finally { await engine.dispose(); }
});
it("lists the distinct priority-200 nonprobe encoding importer", () => {
  const registry = createRegistry([]);
  expect(registry.list("read").find(service => service.id === "Gnumeric_Excel:excel_enc"))
    .toMatchObject({ probePriority: 200, encodingDependent: true, extensions: [], contentProbe: false });
  expect(registry.select("read", "Gnumeric_Excel:excel_enc")?.probeContent).toBeUndefined();
  expect(registry.select("read", "Gnumeric_Excel:excel_enc")?.probeName).toBeUndefined();
});
it.each([0x009, 0x209, 0x409, 0x809])("reads original worksheet numbers for BOF %x", async opcode => {
  const bytes = concat(record(opcode, [0, opcode === 0x809 ? 6 : 0, 16, 0]), numberCell(opcode === 9 ? 3 : 0x203), record(10));
  expect(await probeBiff(bytes, biffContext)).toBe(true);
  expect((await readBiff(bytes, biffContext)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it("uses workbook CODEPAGE after the native initial encoding override", async () => {
  const worksheet = concat(record(0x809, [0, 5, 16, 0]), record(0x204, [0, 0, 0, 0, 0, 0, 1, 0, 0xc0]), record(10));
  const globals = concat(record(0x809, [0, 5, 5, 0]), record(0xe0, new Uint8Array(16)));
  const bytes = concat(globals, record(0x42, [0xe3, 4]), record(10), worksheet);
  expect((await readBiff(bytes, biffContext)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "А" });
  expect((await readBiff(bytes, biffContext, "windows-1252")).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "А" });
  expect((await readBiff(concat(globals, record(10), worksheet), biffContext)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "À" });
  expect((await readBiff(concat(globals, record(10), worksheet), biffContext, "windows-1251")).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "А" });
});
it("switches compressed Unicode width only while CONTINUE splits SST characters", async () => {
  const bytes = concat(record(0x809, [0, 6, 5, 0]),
    record(0xfc, [1, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 65]), record(0x3c, [1, 0xa9, 3, 66, 0]), record(10),
    record(0x809, [0, 6, 16, 0]), record(0xfd, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), record(10));
  expect((await readBiff(bytes, biffContext)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "AΩB" });
});
it("translates RPN formula tokens and preserves the numeric cache", async () => {
  const data = new Uint8Array(29), view = new DataView(data.buffer);
  view.setFloat64(6, 3, true); view.setUint16(20, 7, true); data.set([0x1e, 1, 0, 0x1e, 2, 0, 3], 22);
  const book = await readBiff(concat(record(0x809, [0, 6, 16, 0]), record(6, data), record(10)), biffContext);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=1+2", cachedResult: { kind: "number", value: 3 } });
});
it("rejects truncated records, missing EOF, encrypted payloads, and observes cancellation", async () => {
  for (const bytes of [concat(record(0x209, [0, 3, 16, 0]), new Uint8Array([3, 2, 14, 0, 0])),
    concat(record(0x209, [0, 3, 16, 0]), numberCell()),
    concat(record(0x809, [0, 6, 5, 0]), record(0x2f, [1, 0]), record(10))])
    await expect(readBiff(bytes, biffContext)).rejects.toThrow();
  const controller = new AbortController(), reason = new Error("stop"); controller.abort(reason);
  await expect(readBiff(new Uint8Array(), { ...biffContext, signal: controller.signal })).rejects.toBe(reason);
});
it.each([
  [932, [0x93, 0xfa, 0x96, 0x7b], "日本"], [936, [0xd6, 0xd0], "中"],
  [949, [0xc7, 0xd1], "한"], [950, [0xa4, 0xa4], "中"], [1361, [0xd0, 0x65], "한"]
] as const)("decodes original codepage-%i byte strings using captured GSF mappings", (codepage, bytes, text) => {
  expect(biffDecode(new Uint8Array(bytes), codepage)).toBe(text);
  expect(() => biffDecode(new Uint8Array([bytes[0]!]), codepage)).toThrow();
});
it("uses legacy LABEL's XF font charset and limits -E to ANSI font charset zero", async () => {
  const font = (charset: number) => {
    const bytes = new Uint8Array(19), view = new DataView(bytes.buffer); view.setUint16(0, 200, true);
    view.setUint16(6, 400, true); bytes[12] = charset; bytes[14] = 4; bytes.set([83, 97, 110, 115], 15); return record(0x31, bytes);
  };
  const worksheet = concat(record(0x809, [0, 5, 16, 0]), record(0x204, [0, 0, 0, 0, 0, 0, 1, 0, 0xc0]), record(10));
  const workbook = (charset: number) => concat(record(0x809, [0, 5, 5, 0]), record(0x42, [0xe3, 4]), font(charset), record(0xe0, new Uint8Array(16)), record(10), worksheet);
  expect((await readBiff(workbook(204), biffContext, "windows-1252")).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "А" });
  expect((await readBiff(workbook(0), biffContext)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "À" });
  expect((await readBiff(workbook(0), biffContext, "windows-1251")).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "А" });
});
