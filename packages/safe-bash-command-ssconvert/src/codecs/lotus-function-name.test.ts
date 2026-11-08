import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readLotus } from "./lotus.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 4, operations: 1000, workbookWork: 100000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
it.each([false, true])("recalculates standard SUM rather than a quoted function name (WK3=%s)", async modern => {
  const tokens = modern ? [5, 4, 0, 5, 6, 0, 80, 2, 3] : [5, 2, 0, 5, 3, 0, 80, 2, 3];
  const input = modern ? [...record(0, [2, 16, ...Array<number>(14).fill(0), 1, 0, 0]), ...record(25, [0, 0, 0, 0, ...Array<number>(10).fill(0), ...tokens]), ...record(1)] :
    [...record(0, [5, 4]), ...record(16, [113, 0, 0, 0, 0, ...Array<number>(8).fill(0), ...word(tokens.length), ...tokens]), ...record(1)];
  const book = await readLotus(Uint8Array.from(input), context);
  expect(book.sheets[0]?.cells[0]?.formula).toBe("=SUM(2,3)");
  expect(recalculateWorkbook(book, context, true).sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 5 });
});
