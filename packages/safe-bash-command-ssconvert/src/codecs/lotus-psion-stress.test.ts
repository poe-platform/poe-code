import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { probeLotus, readLotus } from "./lotus.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

function context(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 1000 }, ...overrides };
}
function record(id: number, data: number[] = []): number[] {
  return [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data];
}
function lotus(data: number[]): Uint8Array { return Uint8Array.from([...record(0, [4, 4]), ...data]); }
function formula(column: number): number[] {
  return record(16, [113, column, 0, 0, 0, ...Array<number>(8).fill(0), 4, 0, 5, 1, 0, 3]);
}
function modernLotus(data: number[]): Uint8Array {
  return Uint8Array.from([...record(0, [5, 16, ...Array<number>(14).fill(0), 1, 0, 0]), ...data, ...record(1)]);
}

it("Lotus modern sheet-name record updates the namespace using source opcode 0x204", async () => {
  const book = await readLotus(modernLotus(record(0x204, [...Array<number>(10).fill(0), 88, 0])), context());
  expect(book.sheets[0]!.name).toBe("X");
});

it("Lotus LMBCS group 12 uses the captured libgsf codepage 950 mapping", async () => {
  const book = await readLotus(modernLotus(record(22, [0, 0, 0, 0, 39, 0x12, 0xa4, 0xa4, 0])), context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "中" });
});

it("Lotus LMBCS group 12 drops source-invalid lead bytes and incomplete pairs", async () => {
  const book = await readLotus(modernLotus(record(22, [0, 0, 0, 0, 39, 0x12, 0x80, 0x41, 0x12, 0xff, 0x41, 0x12, 0xa4])), context());
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "" });
});

it.each([0x800, 0x802, 0x803, 0x804])("Lotus malformed metadata 0x%x warns without losing later cells", async id => {
  const warnings: string[] = [];
  const book = await readLotus(modernLotus([...record(id, [0]), ...record(20, [0, 0, 0, 0])]),
    context({ async diagnostic(d) { warnings.push(d.message); } }));
  expect(warnings).toEqual([`Record with type 0x${id.toString(16)} has wrong length 1.`]);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "error", value: "#VALUE!" });
});

it("Lotus sheet layout and COLW4 apply native approximate point widths", async () => {
  const book = await readLotus(modernLotus([...record(6, [0, 0, 0, 0, 11]),
    ...record(7, [0, 0, 0, 0, 2, 22, 2, 33, 4, 11])]), context());
  expect(book.sheets[0]!.view?.defaultColumnWidth).toBeCloseTo(82.6896551724138);
  expect(book.sheets[0]!.columns?.map(c => c.index)).toEqual([2, 4]);
  expect(book.sheets[0]!.columns?.[0]?.sizePoints).toBeCloseTo(247.057471264368);
  expect(book.sheets[0]!.columns?.[1]?.sizePoints).toBeCloseTo(82.6896551724138);
});

it("Lotus invalid sheet layout length warns and keeps the next width record", async () => {
  const warnings: string[] = [];
  const book = await readLotus(modernLotus([...record(6, [0]), ...record(6, [0, 0, 0, 0, 11])]),
    context({ async diagnostic(d) { warnings.push(d.message); } }));
  expect(warnings).toEqual(["Record with type 0x6 has wrong length 1."]);
  expect(book.sheets[0]!.view?.defaultColumnWidth).toBeCloseTo(82.6896551724138);
});

it("Lotus COLW4 consumes work budget for each width assignment including replacement", async () => {
  const c = context();
  await expect(readLotus(modernLotus(record(7, [0, 0, 0, 0, 1, 11, 1, 22])),
    { ...c, limits: { ...c.limits, operations: 1 } })).rejects.toThrow("operations limit exceeded");
});

it("Lotus COLW4 ignores a dangling byte and sorts column metadata without creating cells", async () => {
  const book = await readLotus(modernLotus(record(7, [0, 0, 0, 0, 255, 0, 0, 255, 8])), context());
  expect(book.sheets[0]!.cells).toEqual([]);
  expect(book.sheets[0]!.columns).toEqual([{ index: 0, sizePoints: (3315000 + 880) / 1740 },
    { index: 255, sizePoints: 880 / 1740 }]);
});

it("Lotus width records enforce sheet admission even with no cell records", async () => {
  const c = context();
  await expect(readLotus(modernLotus(record(6, [0, 0, 0, 0, 11])),
    { ...c, limits: { ...c.limits, sheets: 0 } })).rejects.toThrow("sheets limit exceeded");
});

it("Lotus default-width assignments consume the operation budget", async () => {
  const c = context();
  await expect(readLotus(modernLotus(record(6, [0, 0, 0, 0, 11])),
    { ...c, limits: { ...c.limits, operations: 0 } })).rejects.toThrow("operations limit exceeded");
});

it("Lotus unknown modern records warn while source-ignored records stay silent", async () => {
  const warnings: string[] = [];
  await readLotus(modernLotus([...record(3), ...record(0xdead, [1, 2]), ...record(20, [0, 0, 0, 0])]),
    context({ async diagnostic(d) { warnings.push(d.message); } }));
  expect(warnings).toEqual(["Unknown record 0xdead of length 2."]);
});

it("Lotus formula work consumes a cumulative invocation operation budget", async () => {
  const c = context();
  await expect(readLotus(lotus([...formula(0), ...formula(1)]),
    { ...c, limits: { ...c.limits, operations: 1 } })).rejects.toThrow("operations limit exceeded");
});

it("Lotus cancellation from the last format diagnostic preserves the abort reason", async () => {
  const controller = new AbortController(), reason = new Error("last record cancellation");
  await expect(readLotus(lotus(record(13, [96, 0, 0, 0, 0, 1, 0])), context({ signal: controller.signal,
    async diagnostic() { controller.abort(reason); } }))).rejects.toBe(reason);
});

it("Lotus SS98 signature recognizes version 0x1005 and leaves unknown versions explicit", async () => {
  expect(probeLotus(Uint8Array.from(record(0, [5, 16, ...Array<number>(17).fill(0)])), context())).toBe(true);
  const bytes = modernLotus(record(20, [0, 0, 0, 0])); bytes[4] = 6;
  expect(probeLotus(bytes, context())).toBe(false);
  const warnings: string[] = [];
  const book = await readLotus(bytes, context({ async diagnostic(d) { warnings.push(d.message); } }));
  expect(warnings).toEqual(["Unexpected version 1006"]);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#VALUE!" });
});

it("Psion rejects an altered UID checksum", async () => {
  const fixture = psionFixture(); fixture[12] = fixture[12]! ^ 1;
  await expect(readPsion(fixture, context())).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion rejects an out-of-bounds section-table offset", async () => {
  const fixture = psionFixture(); new DataView(fixture.buffer).setUint32(16, 399, true);
  await expect(readPsion(fixture, context())).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion rejects a truncated mandatory page layout", async () => {
  await expect(readPsion(psionFixture().slice(0, 341), context()))
    .rejects.toThrow("Error while parsing Psion file.");
});

it("Psion signed integer replacement consumes one distinct cell slot", async () => {
  const c = context();
  const book = await readPsion(psionFixture([0, 0, 0, 32, 7, 0, 0, 0, 0, 0, 0, 32, 255, 255, 255, 255], 2),
    { ...c, limits: { ...c.limits, cells: 1 } });
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: -1 }, format: "General", style: { fontName: "T", fontSize: 10, fontColor: "#000000", italic: false, bold: false, underline: false, strike: false } }]);
});

it.each([readLotus, readPsion])("legacy readers preserve pre-aborted signal identity (%#)", async reader => {
  const controller = new AbortController(), reason = { aborted: true }; controller.abort(reason);
  await expect(reader(new Uint8Array(), context({ signal: controller.signal }))).rejects.toBe(reason);
});

it("Psion calculated cells with absent formula IDs preserve their cache", async () => {
  const book = await readPsion(psionFixture([0, 0, 0, 40, 7, 0, 0, 0, 0]), context());
  expect(book.sheets[0]!.cells[0]).toEqual({ row: 0, column: 0, value: { kind: "number", value: 7 }, format: "General", style: { fontName: "T", fontSize: 10, fontColor: "#000000", italic: false, bold: false, underline: false, strike: false } });
});

it("Psion grid rejects a missing mandatory unknown-byte trailer", async () => {
  const fixture = psionFixture(), bytes = new Uint8Array(500);
  bytes.set(fixture); bytes.set(fixture.subarray(220, 252), 468);
  new DataView(bytes.buffer).setUint32(136, 468, true);
  await expect(readPsion(bytes, context())).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion grid rejects a truncated freeze trailer after its 22 unknown bytes", async () => {
  const fixture = psionFixture(), bytes = new Uint8Array(478);
  bytes.set(fixture); bytes.set(fixture.subarray(220, 252), 420); bytes[420] = 143;
  new DataView(bytes.buffer).setUint32(136, 420, true);
  await expect(readPsion(bytes, context())).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion page layout rejects a truncated page dimensions trailer", async () => {
  await expect(readPsion(psionFixture().slice(0, 392), context())).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion page header content requires a valid TextEd body", async () => {
  const fixture = psionFixture(); fixture[368] = 1;
  await expect(readPsion(fixture, context())).rejects.toThrow("Error while parsing Psion file.");
});
