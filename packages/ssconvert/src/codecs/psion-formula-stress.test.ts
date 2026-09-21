import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 20, sheets: 4, operations: 10000 } };
const integer = (n: number) => [32, n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
function fixture(tokens: readonly number[], reference = 0): Uint8Array {
  const bytes = new Uint8Array(800);
  bytes.set(psionFixture([0, 0, 0, 40, 7, 0, 0, 0, reference << 1]));
  new DataView(bytes.buffer).setUint32(69, 500, true);
  const length = tokens.length + 1;
  const s = length < 64 ? [(length << 2) | 2] : [((length << 3) | 5) & 255, length >> 5];
  bytes.set([2, 2, ...s, ...tokens, 21], 500);
  return bytes;
}

// Primary source formula_elements indices: 42 = opsep, 43 = opend.
it("Psion SUM uses released operand separator 42 and operand end 43", async () => {
  const book = await readPsion(fixture([152, ...integer(2), 42, ...integer(3), 43, 152, 2, 0]), context);
  expect(book.sheets[0]!.cells[0]).toEqual({ row: 0, column: 0, value: { kind: "number", value: 7 }, format: "General", style: { fontName: "T", fontSize: 10, fontColor: "#000000", italic: false, bold: false, underline: false, strike: false } });
});

it("Psion accepts the source optional separator before vararg operand end", async () => {
  const book = await readPsion(fixture([152, ...integer(2), 42, 43, 152, 1, 0]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});

it("Psion rejects unknown opcode 44 rather than treating it as an operand end", async () => {
  await expect(readPsion(fixture([152, ...integer(2), 43, 44, 152, 1, 0]), context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion nested unsupported varargs retain the cell cache", async () => {
  const tokens = [152, 145, ...integer(2), 43, 145, 1, 0, 42, ...integer(3), 43, 152, 2, 0];
  const book = await readPsion(fixture(tokens), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it.each([
  [152, 43, 152, 0, 0],
  [152, ...integer(2), 42, 21],
  [152, ...integer(2), 43, 151, 1, 0],
  [152, ...integer(2), 43, 152, 2, 0],
  [...integer(2), 42],
  [...integer(2), 43],
  [255],
  [...integer(2), 52],
  [...integer(2), ...integer(3), ...integer(4), 86],
].map(tokens => [tokens]))("Psion rejects malformed source framing or fixed arity (%#)", async tokens => {
  await expect(readPsion(fixture(tokens), context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion out-of-range reverse formula index retains its native cache-only behavior", async () => {
  const book = await readPsion(fixture(integer(2), 1), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Psion signed relative offsets are resolved against each calculated cell", async () => {
  const bytes = fixture([39, 1, 128, 1, 128, 0]);
  bytes[163] = 4; bytes[164] = 4; // B2; row/column offsets each -1.
  const book = await readPsion(bytes, context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=A1");
});

it("Psion relative coordinates before the worksheet become reference errors", async () => {
  const book = await readPsion(fixture([39, 1, 128, 0, 0, 0]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=#REF!");
});

it("Psion formula payload cannot cross its declared byte end", async () => {
  const bytes = fixture(integer(2)); bytes[502] = 6; // Declares one byte, then integer payload remains.
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion formula cursor checks injected cancellation during token traversal", async () => {
  const stop = new Error("stop Psion token walk"); let checks = 0;
  const controller = new AbortController();
  const signal = { throwIfAborted() {
    if (++checks === 80) controller.abort(stop);
    controller.signal.throwIfAborted();
  } } as AbortSignal;
  await expect(readPsion(fixture([...integer(2), ...Array<number>(100).fill(18)]), { ...context, signal })).rejects.toBe(stop);
  expect(checks).toBe(81); // Reader catch rechecks cancellation without continuing tokens.
});

it("Psion literal floats preserve psiconv's discarded least mantissa bit", async () => {
  const book = await readPsion(fixture([31, 1, 0, 0, 0, 0, 0, 240, 63]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=1");
});

it("Psion cell floats preserve psiconv's discarded least mantissa bit", async () => {
  const bytes = psionFixture([0, 0, 0, 128, 1, 0, 0, 0, 0, 0, 240, 63]);
  const book = await readPsion(bytes, context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 1 });
});

it("Psion literal strings use the released psiconv default character table", async () => {
  const book = await readPsion(fixture([38, 5, 16, 160, 129, 0, 233]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe('="\u00a0???é"');
});

it("Psion cell strings use the released psiconv default character table", async () => {
  const bytes = psionFixture([0, 0, 0, 160, 22, 16, 160, 129, 0, 233]);
  const book = await readPsion(bytes, context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "\u00a0???é" });
});
