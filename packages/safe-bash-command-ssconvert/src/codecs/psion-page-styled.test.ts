import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 10000 } };
const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
function fixture(layout: number[]): Uint8Array {
  const bytes = new Uint8Array(1200); bytes.set(psionFixture());
  new DataView(bytes.buffer).setUint32(49, 500, true);
  bytes.set([...dword(1), ...Array<number>(24).fill(0), 1, 0, 0, 0, 0, ...dword(0), ...dword(0),
    ...dword(0x1000005c), ...dword(0x10000066), ...dword(900), ...dword(0x10000064), 4, 72, 6,
    ...Array<number>(6).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0], 500);
  bytes.set(layout, 900); return bytes;
}

it("Psion styled page layout parses normal base styles in anonymous types and paragraphs", async () => {
  const layout = [1, 0, 1, ...dword(1), ...dword(0), 0, ...dword(0),
    ...dword(1), ...dword(2), 0, ...dword(0), 0, ...dword(0), ...dword(0)];
  const book = await readPsion(fixture(layout), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Psion styled page anonymous type base references must exist in the wrapper's normal-only styles", async () => {
  const layout = [1, 0, 1, ...dword(1), ...dword(0), 255, ...dword(0), ...dword(0), ...dword(0)];
  await expect(readPsion(fixture(layout), context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion styled page paragraph unknown base style falls back to normal", async () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 255, ...dword(0), ...dword(0)];
  const book = await readPsion(fixture(layout), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Psion styled page base-style pointer cannot leave the byte input", async () => {
  const layout = [1, 0, 1, ...dword(1), ...dword(1000)];
  await expect(readPsion(fixture(layout), context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion native-ignored page fonts do not pass through Gnumeric's Sheet-only ABI cast", async () => {
  const charCodes = [0x22, 2, 0xe9, 3];
  const layout = [1, 0, 1, ...dword(1), ...dword(0), 0, ...dword(charCodes.length), ...charCodes,
    ...dword(1), ...dword(2), 1, ...dword(0)];
  const book = await readPsion(fixture(layout), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Psion native-ignored paragraph bullet fonts structurally parse Unicode names", async () => {
  const codes = [21, 11, ...dword(240), 42, 1, 0, 0, 0, 2, 0xe9, 3];
  const bytes = psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 1, ...dword(codes.length), ...codes]);
  const book = await readPsion(bytes, context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});
