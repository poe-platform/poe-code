import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readLotus } from "./lotus.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 }
};
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
function fixture(version: number, named: boolean): Uint8Array {
  const modern = version >= 0x1000;
  const number = (n: number) => [5, ...word(modern ? n * 2 : n)];
  const name = Array.from("@<<@123>>YEAR(", c => c.charCodeAt(0));
  const tokens = [...number(124), ...number(1), ...number(1), 54,
    ...(named ? [0x7a, 1, ...word(name.length), ...name] : [62]), 3];
  return Uint8Array.from([
    ...record(0, [...word(version), ...(modern ? [4, 0, ...Array<number>(22).fill(0)] : [])]),
    ...(modern ? record(25, [0, 0, 0, 0, ...Array<number>(10).fill(0), ...tokens])
      : record(16, [...Array<number>(13).fill(0), ...word(tokens.length), ...tokens])),
    ...record(1)
  ]);
}

it.each([[0x404, false], [0x1000, false], [0x1002, false], [0x1002, true]] as const)(
  "imports Lotus YEAR as years since 1900 (version %i, named %s)", async (version, named) => {
    // LibreOffice LotusToSc::DoFunc subtracts 1900 for ocGetYear, including add-ins.
    const book = await readLotus(fixture(version, named), context);
    expect(book.sheets[0]!.cells[0]!.formula).toBe("=(YEAR(DATE(124,1,1))-1900)");
    const result = recalculateWorkbook(book, context, true);
    expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 124 });
  }
);
