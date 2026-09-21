import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 10000 } };
function dword(n: number): number[] { return [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24]; }
it("imports a cell character layout including native font attributes", async () => {
  const codes = [0x19, 255, 64, 0, 0x1c, ...dword(250), 0x1d, 1, 0x1e, 1, 0x20, 1, 0x21, 0, 0x22, 5, 84, 101, 115, 116, 3];
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 2, ...dword(codes.length), ...codes]), context);
  expect(book.sheets[0]?.cells[0]?.style).toEqual({ fontName: "T", fontSize: 12.5, fontColor: "#FF4000", italic: true, bold: true, underline: true, strike: false });
});
it("structurally consumes paragraph layout ignored by Gnumeric", async () => {
  const codes = [1, 1, 2, 3, 2, ...dword(1440), 5, 2, 7, ...dword(240), 8, 1, 0x17, ...dword(720), 1];
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 1, ...dword(codes.length), ...codes]), context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});
it("rejects layout list entries crossing the declared byte boundary", async () => {
  await expect(readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 2, ...dword(1), 0x1c, ...dword(250)]), context)).rejects.toThrow("Error while parsing Psion file.");
});
it("accepts native-ignored page header text and structurally parses its base layouts", async () => {
  const fixture = new Uint8Array(600); fixture.set(psionFixture());
  new DataView(fixture.buffer).setUint32(49, 400, true);
  const page = [...dword(1), ...Array<number>(24).fill(0), 1, 0, 0, 0, 0, ...dword(0), ...dword(0), ...dword(0x1000005c), ...dword(0x10000064), 4, 72, 6, ...Array<number>(6).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0];
  fixture.set(page, 400);
  const book = await readPsion(fixture, context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});
it.each([2, 3, 4, 7, 9, 10, 16, 22])("consumes paragraph length/size code%x", async code => {
  const codes = [code, ...dword(240)];
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 1, ...dword(codes.length), ...codes]), context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});
it.each([5, 6, 8, 11, 12, 13, 14, 15, 0xff])("consumes paragraph boolean/justify/unknown code%x", async code => {
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 1, ...dword(2), code, 1]), context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});
it.each([17, 18, 19, 20])("structurally consumes ignored paragraph border%x", async code => {
  const codes = [code, 1, ...dword(20), 1, 2, 3, 0];
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 1, ...dword(codes.length), ...codes]), context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});
it("consumes paragraph bullet and tab structures ignored by Gnumeric", async () => {
  const codes = [21, 15, ...dword(240), 42, 1, 0, 0, 0, 5, 84, 101, 115, 116, 3, 23, ...dword(720), 1];
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 1, ...dword(codes.length), ...codes]), context);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
});
it.each([0x18, 0x1b, 0x1f, 0x23, 0x24, 0xff])("consumes ignored character code%x", async code => {
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 2, ...dword(2), code, 1]), context);
  expect(book.sheets[0]?.cells[0]?.style?.fontName).toBe("T");
});
it("rejects a zero-sized Psion font character structure", async () => {
  await expect(readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 2, ...dword(2), 0x22, 0]), context)).rejects.toThrow("Error while parsing Psion file.");
});
it("bounds layouts by the invocation operation budget", async () => {
  await expect(readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 2, ...dword(2), 0x1e, 1]), { ...context, limits: { ...context.limits, operations: 1 } })).rejects.toThrow("operations limit exceeded");
});
