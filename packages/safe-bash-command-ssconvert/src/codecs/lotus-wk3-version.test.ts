import { expect, it } from "vitest";
import { createEngine } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { probeLotus, readLotus } from "./lotus.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 }
};
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
function fixture(subtype = 4, headerLength = 26): Uint8Array {
  const name = [...Array.from("Total", c => c.charCodeAt(0)), ...Array<number>(11).fill(0)];
  return Uint8Array.from([
    ...record(0, [...word(0x1000), ...word(subtype), ...Array<number>(headerLength - 4).fill(0)]),
    ...record(9, [0, 0, ...name, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(24, [0, 0, 0, 0, 14, 0]),
    ...record(25, [0, 0, 0, 1, ...Array<number>(10).fill(0), 1, 3, 0, 0, 0, 0, 5, 2, 0, 15, 3]),
    ...record(25, [0, 0, 0, 2, ...Array<number>(10).fill(0), 7, 84, 111, 116, 97, 108, 0, 5, 2, 0, 15, 3]),
    ...record(1)
  ]);
}
it("autodetects the WK3 BOF accepted by LibreOffice ImportLotus::Bof", async () => {
  const bytes = fixture();
  expect(probeLotus(bytes, context)).toBe(true);
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [bytes] }, {}, context);
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  } finally { await engine.dispose(); }
});
it("decodes WK3 modern cell/name references and two-byte numeric tokens", async () => {
  const warnings: string[] = [];
  const book = await readLotus(fixture(), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual([]);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual([undefined, "=(A1+1)", "=(A1+1)"]);
  const result = recalculateWorkbook(book, context, true);
  expect(result.sheets[0]!.cells.map(cell => cell.value)).toEqual([7, 8, 8].map(value => ({ kind: "number", value })));
});
it.each([[5, 26], [4, 25]])("refuses unqualified WK3 BOF subtype %i and length %i", async (subtype, length) => {
  const bytes = fixture(subtype, length);
  expect(probeLotus(bytes, context)).toBe(false);
  await expect(readLotus(bytes, context)).rejects.toThrow("Unsupported WK3 header");
});

it.each([
  [0x1000, 0, [67, 97, 102, 0x82], "Café"],
  [0x1000, 0x10, [67, 97, 102, 0x82], "Café"],
  [0x1000, 0xff, [67, 97, 102, 0x82], "Café"],
  [0x1002, 1, [67, 97, 102, 0x82], "Café"],
  [0x1002, 0x10, [0x93, 0xfa], "日"]
] as const)("decodes names, labels and formula strings for version %i / header byte %i", async (version, byte, text, expected) => {
  // ImportLotus::Bof skips byte 16 for WK3; it cannot override LMBCS group 1.
  const header = [...word(version), ...word(4), ...Array<number>(22).fill(0)]; header[16] = byte;
  const bytes = Uint8Array.from([
    ...record(0, header),
    ...record(9, [0, 0, ...text, ...Array<number>(16 - text.length).fill(0), ...Array<number>(8).fill(0)]),
    ...record(22, [0, 0, 0, 0, 39, ...text, 0]),
    ...record(25, [0, 0, 0, 1, ...Array<number>(10).fill(0), 6, ...text, 0, 3]),
    ...record(26, [0, 0, 0, 1, ...text, 0]),
    ...record(26, [0, 0, 0, 2, ...text, 0]),
    ...record(25, [0, 0, 0, 3, ...Array<number>(10).fill(0), 7, ...text, 0, 3]),
    ...record(1)
  ]);
  const original = bytes.slice(), diagnostics: string[] = [];
  const book = await readLotus(bytes, { ...context, async diagnostic(d) { diagnostics.push(d.message); } });
  expect(diagnostics).toEqual([]);
  expect(book.names?.map(name => name.name)).toEqual([expected]);
  expect(book.sheets[0]!.cells[1]).toMatchObject({ formula: `="${expected}"`, cachedResult: { kind: "string", value: expected } });
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
    Array.from({ length: 4 }, () => ({ kind: "string", value: expected })));
  expect(bytes).toEqual(original);
});
