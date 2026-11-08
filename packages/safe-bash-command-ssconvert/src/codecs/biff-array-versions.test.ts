import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];

function arrayWorkbook(revision: number, strings: boolean, truncate = 0): Uint8Array {
  const bytes = record(revision === 2 ? 9 : revision === 3 ? 0x209 : revision === 4 ? 0x409 : 0x809,
    [0, revision >= 7 ? revision === 8 ? 6 : 5 : 0, 16, 0]);
  for (let row = 0; row < 2; row++) {
    const start = revision === 2 ? 17 : revision <= 4 ? 18 : 22;
    const tokens = revision === 2 ? [1, 0, 0, 0] : [1, 0, 0, 0, 0];
    const header = new Uint8Array(start), view = new DataView(header.buffer), cache = revision === 2 ? 7 : 6;
    header[0] = row;
    if (strings) view.setUint16(cache + 6, 0xffff, true);
    else view.setFloat64(cache, 10 + row, true);
    if (revision === 2) header[16] = tokens.length;
    else view.setUint16(start - 2, tokens.length, true);
    bytes.push(...record(6, [...header, ...tokens]));
    if (row === 0) {
      // Excel File Format 1.42 sections 3.1.1/5.4; LibreOffice Array25/34.
      const start = revision === 2 ? 8 : revision <= 4 ? 10 : 14;
      const arrayTokens = [0x20, ...new Array<number>(revision === 2 ? 6 : 7).fill(0)];
      const header = new Uint8Array(start), view = new DataView(header.buffer); header[2] = 1;
      if (revision === 2) header[7] = arrayTokens.length;
      else view.setUint16(start - 2, arrayTokens.length, true);
      const extra = revision === 8 ? [0, 1, 0] : [1, 2, 0];
      for (const value of [1, 2]) {
        if (strings) extra.push(2, ...(revision === 8 ? [1, 0, 0] : [1]), 119 + value);
        else {
          const payload = new Uint8Array(9); payload[0] = 1;
          new DataView(payload.buffer).setFloat64(1, value, true); extra.push(...payload);
        }
      }
      const payload = [...header, ...arrayTokens, ...extra];
      bytes.push(...record(revision === 2 ? 0x21 : 0x221, truncate ? payload.slice(0, truncate) : payload));
    }
    if (strings) bytes.push(...record(revision === 2 ? 7 : 0x207,
      revision === 8 ? [1, 0, 0, 97 + row] : revision === 2 ? [1, 97 + row] : [1, 0, 97 + row]));
  }
  bytes.push(...record(10, []));
  return Uint8Array.from(bytes);
}

for (const revision of [2, 3, 4, 7, 8]) for (const strings of [false, true]) {
  it(`reads original BIFF${revision} ARRAY headers, auxiliary ${strings ? "strings" : "numbers"} and cell caches`, async () => {
    const imported = await readBiff(arrayWorkbook(revision, strings), context);
    expect(imported.sheets[0]!.cells.map(cell => cell.cachedResult)).toEqual(strings
      ? [{ kind: "string", value: "a" }, { kind: "string", value: "b" }]
      : [{ kind: "number", value: 10 }, { kind: "number", value: 11 }]);
    for (const book of [imported,
      await readBiff(await createBiffWriter(7)(imported, [], context), context),
      await readBiff(await createBiffWriter(8)(imported, [], context), context)]) {
      expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "array", expression: strings ? '={"x";"y"}' : "={1;2}" }]);
      expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(strings
        ? [{ kind: "string", value: "x" }, { kind: "string", value: "y" }]
        : [{ kind: "number", value: 1 }, { kind: "number", value: 2 }]);
    }
  });
}

it.each([6, 7, 8, 14])("rejects truncated BIFF2 ARRAY payload at %i bytes", truncate => {
  return expect(readBiff(arrayWorkbook(2, false, truncate), context)).rejects.toThrow("Invalid Excel BIFF");
});
