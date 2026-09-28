import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];

for (const [profile, version, windows] of [["WK1", 0x404, false], ["WK2", 0x406, false],
  ["Symphony", 0x405, false], ["Windows Works", 0x404, true]] as const) {
  for (const [firstInvalid, lastInvalid] of [[true, false], [false, true], [true, true]] as const) {
    it.each([false, true])(`${profile} propagates invalid range endpoints ${firstInvalid}/${lastInvalid} (SUM=%s)`, async sum => {
      // A relative -1 row at row zero is invalid in all four native layouts.
      const endpoint = (invalid: boolean) => [...word(1), ...word(invalid ? 0xbfff : 0)];
      const tokens = [2, ...endpoint(firstInvalid), ...endpoint(lastInvalid), ...(sum ? [80, 1] : []), 3];
      const bytes = Uint8Array.from([...record(windows ? 255 : 0, word(version)),
        ...record(16, [...Array<number>(windows ? 6 : 5).fill(0), ...Array<number>(8).fill(0), ...word(tokens.length), ...tokens]),
        ...record(1)]);
      const book = await readLotus(bytes, context);
      expect(book.sheets[0]!.cells[0]!.formula).toBe(sum ? "=SUM(#REF!)" : "=#REF!");
      const result = recalculateWorkbook(book, context, true);
      expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
      const output = await createXlsxWriter("2008")(result, [], context);
      expect((await readXlsx(output, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
    });
  }
}
