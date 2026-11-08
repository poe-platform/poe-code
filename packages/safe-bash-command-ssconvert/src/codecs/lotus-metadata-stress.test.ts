import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 4, operations: 10000 } };
const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
const record = (id: number, data: readonly number[] = []) => [id & 255, id >>> 8, data.length & 255, data.length >>> 8, ...data];
const file = (...records: readonly number[][]) => Uint8Array.from([
  ...record(0, [5, 16, ...Array<number>(14).fill(0), 1, 0, 0]), ...records.flat(), ...record(1)]);
const database = (...sizes: number[]) => record(0x804, [0, 0, sizes.length, 0, ...sizes.flatMap(dword)]);

it("Lotus DUPFMT copies number formats from a source range without source cells", async () => {
  const book = await readLotus(file(record(5, Array<number>(16).fill(0)), record(0x293), database(1, 1, 1),
    record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(1)), record(0x801, dword(0x32)), record(0x293),
    record(0x13, [0, 2, 1, 0, 0, 0, 0, 0]), record(20, [1, 0, 0, 0])), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.00%");
});

it.each([[false, "Unfinished rldb."], [true, "Unused rldb."]])("Lotus warns about retained RLDB at EOF (%s)", async (complete, message) => {
  const warnings: string[] = [];
  await readLotus(file(record(20, [0, 0, 0, 0]), database(1), ...(complete ? [record(0x800, dword(1))] : [])),
    { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual([message]);
});

it("Lotus RLDB walking stops at the sheet column boundary", async () => {
  const book = await readLotus(file(record(5, Array<number>(16).fill(0)), record(0x293), database(1, 257, 1),
    record(0x800, dword(1)), record(0x800, dword(256)), record(0x800, dword(1)), record(0x801, dword(0x32)),
    record(0x800, dword(1)), record(0x800, dword(1)), record(0x801, dword(0x31)), record(0x293)), context);
  expect(book.sheets[0]!.unsupportedRecords).toEqual([{ source: "lotus", kind: "FormatRange", disposition: "retained",
    data: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 255, format: "0.00%" } }]);
});

it("Lotus RLDB walking stops at the sheet row boundary", async () => {
  const book = await readLotus(file(record(5, Array<number>(16).fill(0)), record(0x293), database(65537, 1, 1),
    record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(65536)), record(0x801, dword(0x32)),
    record(0x800, dword(1)), record(0x801, dword(0x31)), record(0x293)), context);
  expect(book.sheets[0]!.unsupportedRecords).toEqual([{ source: "lotus", kind: "FormatRange", disposition: "retained",
    data: { startRow: 0, endRow: 65535, startColumn: 0, endColumn: 0, format: "0.00%" } }]);
});

it("Lotus EOF warnings preserve injected cancellation", async () => {
  const controller = new AbortController(), reason = new Error("stop at EOF warning");
  await expect(readLotus(file(record(20, [0, 0, 0, 0]), database(1)), { ...context, signal: controller.signal,
    async diagnostic(d) { expect(d.message).toBe("Unfinished rldb."); controller.abort(reason); } })).rejects.toBe(reason);
});

it("Lotus RLDB undefined or unfinished subtree reuse fails before application", async () => {
  await expect(readLotus(file(record(20, [0, 0, 0, 0]), database(1, 2), record(0x802, [1, 0]),
    record(0x800, dword(1)), record(0x803, [1, 0])), context)).rejects.toThrow("Error while reading lotus workbook.");
});

it("Lotus DUPFMT metadata scanning shares the invocation operation budget", async () => {
  await expect(readLotus(file(record(0x13, [0, 0, 0, 0, 0x32, 0, 0, 0]),
    record(0x13, [0, 2, 1, 0, 0, 0, 0, 0])),
    { ...context, limits: { ...context.limits, operations: 50 } })).rejects.toThrow("operations limit exceeded");
});

it("Lotus DUPFMT clears target font attributes when the source row is default", async () => {
  const book = await readLotus(file(record(0x1b, [0xdc, 15, 7, 0, 0, 0, 0, 0, 0, 0, 88, 0]),
    record(20, [0, 0, 0, 0]), record(0x284), database(1, 1, 1),
    record(0x800, dword(1)), record(0x800, dword(1)), record(0x800, dword(1)), record(0x801, [7, 0]), record(0x284),
    record(0x13, [0, 2, 0, 0, 0, 0, 1, 0]), record(20, [0, 0, 0, 0])), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual({});
  expect(book.sheets[0]!.cells[0]!.format).toBe("General");
});
