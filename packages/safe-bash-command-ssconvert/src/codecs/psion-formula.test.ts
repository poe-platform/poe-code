import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 20, sheets: 4, operations: 1000 } };
function formulaFixture(formulas: number[][], reference = 0): Uint8Array {
  const bytes = new Uint8Array(800);
  bytes.set(psionFixture([0, 0, 0, 40, 7, 0, 0, 0, reference << 1]));
  new DataView(bytes.buffer).setUint32(69, 500, true);
  const s = (length: number) => length < 64 ? [(length << 2) | 2] : [((length << 3) | 5) & 255, length >> 5];
  bytes.set([2, formulas.length << 1, ...formulas.flatMap(f => [...s(f.length + 1), ...f, 21])], 500);
  return bytes;
}
const integer = (n: number) => [32, n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];

it("Psion calculated arithmetic imports an expression and its original cache", async () => {
  const book = await readPsion(formulaFixture([[...integer(2), ...integer(3), 7]]), context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=(2+3)", cachedResult: { kind: "number", value: 7 }, formulaDirty: false });
});
it("Psion formula IDs count backwards from the end of the list", async () => {
  const book = await readPsion(formulaFixture([integer(2), integer(3)]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=3");
});
it("Psion source-unsupported ABS preserves cached values without inventing an expression", async () => {
  const book = await readPsion(formulaFixture([[...integer(-2), 106]]), context);
  expect(book.sheets[0]!.cells[0]).toEqual({ row: 0, column: 0, value: { kind: "number", value: 7 }, format: "General", style: { fontName: "T", fontSize: 10, fontColor: "#000000", italic: false, bold: false, underline: false, strike: false } });
});
it("Psion relative references translate in the calculated cell coordinate context", async () => {
  const book = await readPsion(formulaFixture([[39, 1, 0, 2, 0, 0]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=C2");
});
it("Psion rejects a corrupted formula stack even if its cache is usable", async () => {
  await expect(readPsion(formulaFixture([[7]]), context)).rejects.toThrow("Error while parsing Psion file.");
});
it("Psion source-unsupported vararg SUM is parsed and preserves its cache", async () => {
  const book = await readPsion(formulaFixture([[152, ...integer(2), 42, 43, 152, 1, 0]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});

it.each([[1, "<"], [2, "<="], [3, ">"], [4, ">="], [5, "<>"], [6, "="], [7, "+"], [8, "-"], [9, "*"], [10, "/"]])
  ("Psion translated binary opcode %i preserves operand order", async (op, symbol) => {
    const book = await readPsion(formulaFixture([[...integer(2), ...integer(3), Number(op)]]), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe(`=(2${symbol}3)`);
  });

it.each([[12, "+(2)"], [13, "-(2)"], [18, "2"]])("Psion translated unary opcode %i", async (op, expression) => {
  const book = await readPsion(formulaFixture([[...integer(2), Number(op)]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe(`=${expression}`);
});

it.each([11, 14, 15, 16, 17])("Psion untranslated operator %i preserves cache", async op => {
  const book = await readPsion(formulaFixture([[...integer(2), ...(op === 14 ? [] : integer(3)), op]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Psion vcellblock is source-untranslated even though its structural records parse", async () => {
  const book = await readPsion(formulaFixture([[41, 0, 64, 0, 64, 0, 1, 64, 1, 64, 0]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});

it("Psion absolute cell ranges and short strings import", async () => {
  const book = await readPsion(formulaFixture([[40, 0, 64, 0, 64, 0, 1, 64, 1, 64, 0], [38, 3, 97, 34, 98]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe('="a""b"');
  const range = await readPsion(formulaFixture([[40, 0, 64, 0, 64, 0, 1, 64, 1, 64, 0]]), context);
  expect(range.sheets[0]!.cells[0]!.formula).toBe("=$A$1:$B$2");
});

it.each([[152, ...integer(2), 42, 43, 151, 1, 0], [152, ...integer(2), 42, 43, 152, 2, 0], [0], [...integer(1), ...integer(2)]].map(tokens => [tokens]))
  ("Psion formula rejects invalid repeated markers, arity, opcodes or remaining stack (%#)", async tokens => {
    await expect(readPsion(formulaFixture([tokens]), context)).rejects.toThrow("Error while parsing Psion file.");
  });

it("Psion vararg separator parses multiple argument expressions", async () => {
  const book = await readPsion(formulaFixture([[152, ...integer(2), 42, ...integer(3), 43, 152, 2, 0]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
});

it("Psion two-byte formula length and float literals parse", async () => {
  const book = await readPsion(formulaFixture([[31, 0, 0, 0, 0, 0, 0, 248, 63, ...Array<number>(64).fill(18)]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=1.5");
});

it("Psion formula variable references remain source-untranslated", async () => {
  const book = await readPsion(formulaFixture([[37, 0, 0, 0, 0]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("Psion formula bytes must end at their declared EOF", async () => {
  const fixture = formulaFixture([integer(2)]); fixture[502] = 18;
  await expect(readPsion(fixture, context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion formula parsing respects the injected invocation operation budget", async () => {
  await expect(readPsion(formulaFixture([[...integer(2), ...Array<number>(64).fill(18)]]),
    { ...context, limits: { ...context.limits, operations: 60 } })).rejects.toThrow("operations limit exceeded");
});
