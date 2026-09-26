import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 10000 } };
const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
const nativeDefaultStyle = { fontName: "T", fontSize: 10, fontColor: "#000000", italic: false, bold: false, underline: false, strike: false };
const characterLayout = (codes: number[]) => [2, 2, ...dword(codes.length), ...codes];
function fixture(sheetCodes: number[] = [], rowCodes: number[] = [], columnCodes: number[] = [], cellCodes?: number[]): Uint8Array {
  const cell = cellCodes === undefined ? [0, 0, 0, 32, 7, 0, 0, 0] : [0, 0, 0, 48, 7, 0, 0, 0, ...characterLayout(cellCodes)];
  const bytes = new Uint8Array(1200); bytes.set(psionFixture(cell));
  const v = new DataView(bytes.buffer); v.setUint32(103, 500, true);
  bytes.set([4, 1, ...characterLayout(sheetCodes), ...dword(600), ...dword(700), ...dword(160), ...dword(220), ...dword(156)], 500);
  bytes.set(rowCodes.length ? [2, 2, 0, ...characterLayout(rowCodes)] : [2, 0], 600);
  bytes.set(columnCodes.length ? [2, 2, 0, ...characterLayout(columnCodes)] : [2, 0], 700);
  return bytes;
}

it("Psion populated cells receive native basic character defaults even without character records", async () => {
  const book = await readPsion(psionFixture(), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual(nativeDefaultStyle);
});

it("Psion row layouts inherit sheet style and take full precedence over column layouts", async () => {
  const book = await readPsion(fixture([0x1e, 1], [0x1d, 1], [0x21, 1]), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual({ ...nativeDefaultStyle, bold: true, italic: true });
});

it("Psion explicit cell layouts inherit selected row defaults and override a single property", async () => {
  const book = await readPsion(fixture([0x1e, 1], [0x1d, 1], [], [0x1e, 0]), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual({ ...nativeDefaultStyle, italic: true });
});

it("Psion column character layouts inherit the worksheet style", async () => {
  const book = await readPsion(fixture([0x1e, 1], [], [0x21, 1]), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual({ ...nativeDefaultStyle, bold: true, strike: true });
});

it.each([[0x19, 255], [0x1a, 1, 2], [0x1c, 1], [0x22, 3, 65], [0x1e]])
  ("Psion character payload cannot cross its declared list boundary (%#)", async (...codes: number[]) => {
    await expect(readPsion(fixture([], [], [], codes), context)).rejects.toThrow("Error while parsing Psion file.");
  });

it("Psion nonstandard character boolean values follow native true semantics", async () => {
  const book = await readPsion(fixture([], [], [], [0x1d, 255, 0x1e, 2]), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual({ ...nativeDefaultStyle, italic: true, bold: true });
});

it("Psion ASCII font names preserve the source-implied little-endian UCS2 pointer cast", async () => {
  const book = await readPsion(fixture([], [], [], [0x22, 6, 65, 114, 105, 97, 108, 3]), context);
  expect(book.sheets[0]!.cells[0]!.style?.fontName).toBe("A");
});

it("Psion ABI font prefixes containing invalid UTF8 remain explicitly unqualified", async () => {
  await expect(readPsion(fixture([], [], [], [0x22, 2, 0xe9, 3]), context))
    .rejects.toThrow("invalid UTF-8 ABI font names are not qualified");
});

function pageFixture(layout: number[]): Uint8Array {
  const bytes = new Uint8Array(1200); bytes.set(psionFixture());
  new DataView(bytes.buffer).setUint32(49, 500, true);
  bytes.set([...dword(1), ...Array<number>(24).fill(0), 1, 0, 0, 0, 0, ...dword(0), ...dword(0),
    ...dword(0x1000005c), ...dword(0x10000066), ...dword(900), ...dword(0x10000064), 4, 72, 6,
    ...Array<number>(6).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0], 500);
  bytes.set(layout, 900);
  return bytes;
}

it("Psion styleless page layouts consume anonymous paragraphs and empty inline lists", async () => {
  const book = await readPsion(pageFixture([0, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), ...dword(0), ...dword(0)]), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual(nativeDefaultStyle);
});

it("Psion page layout offsets reject out-of-bounds length headers", async () => {
  const bytes = pageFixture([0, 0]); new DataView(bytes.buffer).setUint32(549, 1199, true);
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion empty styled page layouts parse native ignored page content", async () => {
  const book = await readPsion(pageFixture([1, 0, 0, ...dword(0), ...dword(0)]), context);
  expect(book.sheets[0]!.cells[0]!.style).toEqual(nativeDefaultStyle);
});

it("Psion embedded objects without a nested section table retain the explicit native-unsafe gap", async () => {
  const layout = [0, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), ...dword(1), ...dword(1), 1, ...dword(1), ...dword(0)];
  await expect(readPsion(pageFixture(layout), context)).rejects.toThrow("embedded object without a nested section table is not qualified");
});

it("Psion expanded layout payloads remain inside the invocation operation budget", async () => {
  const codes = Array.from({ length: 100 }, () => [0x1e, 1]).flat();
  await expect(readPsion(fixture([], [], [], codes), { ...context, limits: { ...context.limits, operations: 150 } }))
    .rejects.toThrow("operations limit exceeded");
});

it("Psion layout reading preserves exact pre-cancelled reason identity", async () => {
  const controller = new AbortController(), reason = new Error("layout cancellation"); controller.abort(reason);
  await expect(readPsion(fixture([], [], [], [0x1e, 1]), { ...context, signal: controller.signal })).rejects.toBe(reason);
});
