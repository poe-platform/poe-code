import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const formulaContext = { revision: 8, codepage: 1252, row: 0, column: 0, names: [], externalSheets: [], limit: 1000 };
const record = (opcode: number, data: readonly number[]) => [opcode & 255, opcode >> 8, data.length & 255, data.length >> 8, ...data];

// MS-XLS 2.5.198.50/52: deleted natural-language labels, six-byte tokens.
// LibreOffice excform8.cxx maps both to ocErrName, not a local-name lookup.
for (const subtype of [1, 0x10]) {
  it.each([0, 1, 0xfffe, 0xffff])(`imports deleted label ${subtype} with quoted/reserved field %i`, flags => {
    const token = [0x18, subtype, 7, 0, flags & 255, flags >> 8];
    expect(translateBiffFormula(Uint8Array.from([...token, 0x1e, 1, 0, 3]), formulaContext)).toBe("=#NAME?+1");
  });

  it.each([1, 2, 3, 4, 5])(`rejects deleted label ${subtype} truncated to %i bytes`, length => {
    expect(() => translateBiffFormula(Uint8Array.from([0x18, subtype, 7, 0, 0, 0].slice(0, length)), formulaContext))
      .toThrow("Invalid Excel BIFF");
  });

  it(`charges deleted label ${subtype} text against formula work limits`, () => {
    expect(() => translateBiffFormula(Uint8Array.from([0x18, subtype, 7, 0, 0, 0]), { ...formulaContext, limit: 5 }))
      .toThrow("formula work limit");
  });

  it(`recalculates deleted label ${subtype} errors and dependent expressions through BIFF7/8`, async () => {
    const label = [0x18, subtype, 7, 0, 0, 0];
    const expressions = [label, [...label, 0x21, 5, 1], [...label, 0x21, 2, 0], [...label, 0x21, 3, 0],
      [...label, ...label, 3], [0x1d, 0, ...label, 0x1e, 42, 0, 0x22, 3, 1, 0]];
    const bytes = record(0x809, [0, 6, 16, 0]);
    for (const [row, tokens] of expressions.entries()) {
      const data = new Uint8Array(22), view = new DataView(data.buffer);
      view.setUint16(0, row, true); view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true);
      bytes.push(...record(6, [...data, ...tokens]));
    }
    bytes.push(...record(10, []));
    const diagnostics: string[] = [];
    const book = await readBiff(Uint8Array.from(bytes), { ...context, async diagnostic(d) { diagnostics.push(d.code); } });
    const expected = [{ kind: "error", value: "#NAME?" }, { kind: "number", value: 5 },
      { kind: "boolean", value: false }, { kind: "boolean", value: true }, { kind: "error", value: "#NAME?" }, { kind: "number", value: 42 }];
    expect(book.sheets[0]!.cells.map(c => c.formula)).toEqual(["=#NAME?", "=ERROR.TYPE(#NAME?)", "=ISNA(#NAME?)",
      "=ISERROR(#NAME?)", "=#NAME?+#NAME?", "=IF(FALSE,#NAME?,42)"]);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(c => c.value)).toEqual(expected);
    expect(diagnostics).toEqual([]);
    for (const revision of [7, 8] as const) {
      const reopened = await readBiff(await createBiffWriter(revision)(book, [], context), context);
      expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(c => c.value)).toEqual(expected);
    }
  });
}

it.each([2, 3, 4, 7])("does not interpret BIFF8 label tokens in revision %i", revision => {
  expect(() => translateBiffFormula(Uint8Array.from([0x18, 1, 7, 0, 0, 0]), { ...formulaContext, revision }))
    .toThrow("Unsupported ssconvert feature: BIFF formula token");
});

it.each([0x0c, 0x0d, 0x0e, 0x0f, 0x1d])("does not replace unimplemented live label/pivot subtype %i with a deleted-label error", subtype => {
  expect(() => translateBiffFormula(Uint8Array.from([0x18, subtype, ...new Array<number>(13).fill(0)]), formulaContext))
    .toThrow("Unsupported ssconvert feature: BIFF formula token");
});
