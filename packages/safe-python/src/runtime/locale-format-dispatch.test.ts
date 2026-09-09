import { expect, it } from "vitest";
import { integerFormat } from "./integer-format.js";
import { floatFormat } from "./float-format.js";
import { complexFormat } from "./complex-format.js";
import { NumericLocale } from "./numeric-locale.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const text = (s: string) => new CodePointString(Uint32Array.from([...s], c => c.codePointAt(0)!));
const locale = () => new NumericLocale({ decimalPoint: text(","), thousandsSeparator: text("."), grouping: [3, 0] }, budget());
it("dispatches integer n specs with explicit locale snapshots", () => {
  expect([...integerFormat(-1234567n, text("n"), "int", budget(), 4300, locale())]).toEqual([...text("-1.234.567")]);
  expect(() => integerFormat(1n, text(".2n"), "int", budget(), 4300, locale())).toThrow("Precision not allowed");
});
it("dispatches float and complex n specs through immutable output adapters", () => {
  expect([...floatFormat(1234.5, text(".8n"), "float", budget(), locale())]).toEqual([...text("1.234,5")]);
  expect([...complexFormat(1234.5, 2345.6, text(".8n"), "complex", budget(), locale())]).toEqual([...text("1.234,5+2.345,6j")]);
});
it("retains shared syntax rejection and ignores locale for other presentations", () => {
  expect(() => floatFormat(1, text(",n"), "float", budget(), locale())).toThrow("Cannot specify ',' with 'n'.");
  expect(() => complexFormat(1, 2, text("._n"), "complex", budget(), locale())).toThrow("Cannot specify '_' with 'n'.");
  expect([...floatFormat(1234.5, text(".1f"), "float", budget(), locale())]).toEqual([...text("1234.5")]);
});
