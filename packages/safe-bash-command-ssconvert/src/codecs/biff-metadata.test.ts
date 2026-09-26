import { expect, it } from "vitest";
import { readBiff } from "./biff.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };
function fixture(...records: [number, number[] | Uint8Array][]): Uint8Array {
  const bytes: number[] = [];
  for (const [opcode, payload] of records) bytes.push(opcode & 255, opcode >> 8, payload.length & 255, payload.length >> 8, ...payload);
  return new Uint8Array(bytes);
}
it("matches the source and measured native raw worksheet name", async () => {
  expect((await readBiff(fixture([0x209, [0, 3, 16, 0]], [10, []]), context)).sheets[0]!.name).toBe("Worksheet");
});
it("materializes print flags, setup and comments as interoperable Gnumeric metadata", async () => {
  const setup = new Uint8Array(34), view = new DataView(setup.buffer);
  view.setUint16(0, 9, true); view.setUint16(2, 80, true); view.setUint16(10, 2, true);
  view.setFloat64(16, 0.25, true); view.setFloat64(24, 0.25, true);
  const book = await readBiff(fixture([0x809, [0, 5, 16, 0]], [0x2b, [1, 0]], [0x2a, [1, 0]],
    [0x83, [1, 0]], [0xa1, setup], [0x1c, [0, 0, 0, 0, 2, 0, 104, 105]], [10, []]), context);
  const records = book.sheets[0]!.unsupportedRecords!;
  expect(records.find(record => record.kind === "PrintInformation")).toMatchObject({ source: "Gnumeric_XmlIO:sax", disposition: "retained" });
  expect(JSON.stringify(records)).toContain('"text":"iso_a4"');
  expect(JSON.stringify(records)).toContain('"name":"CellComment"');
  expect(JSON.stringify(records)).toContain('"value":"hi"');
});
it("materializes original XF borders, legacy formats and palette colors", async () => {
  const xf = new Uint8Array(20), view = new DataView(xf.buffer);
  view.setUint16(2, 2, true); view.setUint16(10, 1, true); view.setUint16(12, 10, true);
  const cell = new Uint8Array(14); new DataView(cell.buffer).setFloat64(6, 12.5, true);
  const book = await readBiff(fixture([0x809, [0, 6, 16, 0]], [0xe0, xf], [0x203, cell], [10, []]), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.00");
  expect(JSON.stringify(book.sheets[0]!.cells[0]!.style)).toContain('"name":"StyleBorder"');
  expect(JSON.stringify(book.sheets[0]!.cells[0]!.style)).toContain('"value":"FFFF:0:0"');
  const legacyXf = [0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  expect((await readBiff(fixture([0x209, [0, 3, 16, 0]], [0x243, legacyXf], [0x203, cell], [10, []]), context))
    .sheets[0]!.cells[0]!.format).toBe("0.00");
});
it.each([3, 4])("uses legacy FORMAT record sequence indices for BIFF%i", async revision => {
  const prefix = revision === 4 ? [0, 0] : [];
  const cell = new Uint8Array(14); new DataView(cell.buffer).setFloat64(6, 12.5, true);
  const book = await readBiff(fixture([revision === 4 ? 0x409 : 0x209, [0, revision, 16, 0]],
    [revision === 4 ? 0x41e : 0x1e, [...prefix, 7, ...new TextEncoder().encode("General")]],
    [revision === 4 ? 0x41e : 0x1e, [...prefix, 5, ...new TextEncoder().encode("0.000")]],
    [revision === 4 ? 0x443 : 0x243, [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]], [0x203, cell], [10, []]), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.000");
});
