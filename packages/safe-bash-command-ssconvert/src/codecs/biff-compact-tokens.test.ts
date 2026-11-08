import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const formulaContext = (revision: number) => ({ revision, codepage: 1252, row: 0, column: 0,
  names: ["Answer"], externalSheets: [], limit: 1000 });
const integer = [0x1e, 42, 0];
const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];

// LibreOffice excform.cxx Convert: BIFF2 has shorter NAME, ATTR, ARRAY and
// reference-cache payloads. excform8.cxx also skips MemAreaN and MemNoMemN.
for (const revision of [2, 3, 4, 7, 8]) {
  for (const opcode of [0x26, 0x27, 0x28, 0x29, 0x2e, 0x2f]) {
    for (const tokenClass of [0, 0x20, 0x40]) {
      const size = opcode <= 0x28 ? revision === 2 ? 4 : 6 : revision === 2 ? 1 : 2;
      const token = opcode + tokenClass;
      it(`reads BIFF${revision} cache token ${token} without consuming its following expression`, () => {
        let reads = 0;
        const reference = revision === 8 ? [0x24, 1, 0, 0, 0] : [0x24, 1, 0, 0];
        const payload = new Array<number>(size).fill(0);
        payload[size - (revision === 2 ? 1 : 2)] = reference.length;
        const result = translateBiffFormula(Uint8Array.from([token, ...payload, ...reference]),
          { ...formulaContext(revision), readMemory() { reads++; } });
        expect(result).toBe("=$A$2");
        expect(reads).toBe(opcode === 0x26 ? 1 : 0);
      });
    }
  }

  it(`keeps BIFF${revision} name and attribute token boundaries intact`, () => {
    const size = revision === 2 ? 7 : revision >= 8 ? 4 : revision >= 5 ? 14 : 10;
    const name = [0x23, 1, ...new Array<number>(size - 1).fill(0)];
    const sum = revision === 2 ? [0x19, 0x10, 0] : [0x19, 0x10, 0, 0];
    expect(translateBiffFormula(Uint8Array.from([...name, ...sum, ...integer, 3]), formulaContext(revision)))
      .toBe("=SUM(Answer)+42");
    const choose = revision === 2 ? [0x19, 4, 1, 0, 0] : [0x19, 4, 1, 0, 0, 0, 0, 0];
    expect(translateBiffFormula(Uint8Array.from([...choose, ...integer]), formulaContext(revision))).toBe("=42");
  });
}

it.each([0x26, 0x27, 0x28, 0x29, 0x2e, 0x2f, 0x23, 0x20])("rejects a truncated compact BIFF2 token %i", opcode => {
  const size = opcode === 0x23 ? 7 : opcode === 0x20 ? 6 : opcode <= 0x28 ? 4 : 1;
  expect(() => translateBiffFormula(Uint8Array.from([opcode, ...new Array<number>(size - 1).fill(0)]),
    { ...formulaContext(2), readArray: () => "{1}" })).toThrow("Invalid Excel BIFF");
});

function originalBiff2(): Uint8Array {
  const name = [0x23, 1, 0, 0, 0, 0, 0, 0];
  // SUM(Answer) + SUM({1}), with one cached area and one array auxiliary value.
  const tokens = [0x26, 0, 0, 0, name.length, ...name, 0x19, 0x10, 0,
    0x20, 0, 0, 0, 0, 0, 0, 0x19, 0x10, 0, 3];
  const header = new Uint8Array(17); header[16] = tokens.length;
  const extra = [1, 0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 240, 63];
  const named = [0x2e, 4, 0x24, 1, 0, 0];
  const number = new Uint8Array(15); number[0] = 1; new DataView(number.buffer).setFloat64(7, 42, true);
  return Uint8Array.from([...record(9, [0, 2, 16, 0]),
    ...record(0x18, [0, 0, 0, 6, named.length, ...new TextEncoder().encode("Answer"), ...named]),
    ...record(6, [...header, ...tokens, ...extra]), ...record(3, [...number]), ...record(10, [])]);
}

it("imports an original compact BIFF2 name, cached reference and array through BIFF7/8 reexport", async () => {
  const imported = await readBiff(originalBiff2(), context);
  expect(imported.sheets[0]!.cells[0]!.formula).toBe("=SUM(Answer)+SUM({1})");
  for (const book of [imported,
    await readBiff(await createBiffWriter(7)(imported, [], context), context),
    await readBiff(await createBiffWriter(8)(imported, [], context), context)]) {
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 43 });
  }
});
