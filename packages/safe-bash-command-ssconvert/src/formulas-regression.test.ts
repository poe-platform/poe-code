import { expect, it } from "vitest";
import { parseFormula, relocateFormula } from "./workbook/updates/formula.js";
import type { Workbook } from "./workbook.js";

const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [] }] };

it("uses Gnumeric unary precedence and right associative powers", () => {
  expect(parseFormula("=-2^2", book, "s")).toMatchObject({ kind: "binary", op: "^", left: { kind: "unary", op: "-" } });
  expect(parseFormula("=2^3^2", book, "s")).toMatchObject({ kind: "binary", op: "^", right: { kind: "binary", op: "^" } });
});

it("retains omitted function arguments", () => {
  expect(parseFormula("=FUTURE(,A1,)", book, "s")).toMatchObject({ kind: "call", name: "FUTURE", args: [
    { kind: "value", value: { kind: "blank" } }, { kind: "range" }, { kind: "value", value: { kind: "blank" } }
  ] });
});

it("translates endpoints in original order and preserves whole axes", () => {
  for (const [text, expected] of [["=B$2:$A1", "=C$2:$A2"], ["=SUM(A:B)", "=SUM(B:C)"]]) {
    const node = parseFormula(text!, book, "s");
    expect(node).toBeDefined();
    expect(relocateFormula(text!, node!, 1, 1)).toBe(expected);
  }
});
