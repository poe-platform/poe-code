import { expect, it } from "vitest";
import { formatText } from "./number-format.js";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const host = { context, book: {}, tick() { context.signal.throwIfAborted(); } };

it.each<[number, string, string]>([
  [12, "0.", "12."], [2.675, "0.00", "2.67"], [1.005, "0.00", "1.00"],
  [0, "#", "0"], [0, "?", "0"], [0, "??", " 0"], [0, "#.##", "."],
  [-12, "[<0]0;0", "12"], [-12, "[<0]0", "12"], [-12, "[>=10]0;0", "-12"],
  [-12, "[>0]0;0;0", "12"], [-12, "[>=10]0;[<0]0;0", "12"],
  [1234567, "#,##0", "1,234,567"], [12.5, ".00", ".50"],
  [0.99, "# ?/?", "1    "], [12345, "##0.0E+0", "12.3E+3"],
  [1e-308, "0.00E+00", "1.00E-308"], [.99999999, "hh:mm:ss.000", "23:59:59.999"],
  [.5, "ss:mm", "00:00"], [12, '0"E"', "12E"], [12, "0\\x", "12x"],
  [-.0000001, "[h]:mm:ss.000", "0:00:00.009"],
  [12, "0\\E", "12E"], [12, "0\\m", "12m"],
  [-12, "[>=0]0;0", "12"], [-12, "[<=0]0;0", "-12"],
  [9.995, "0.00E+00", "9.99E+00"], [99.95, "00.0E+00", "01.0E+02"],
  [999.95, "##0.0E+0", "1.0E+3"]
])("matches independent native TEXT(%s,%s) bytes", (value, pattern, expected) => {
  expect(formatText({ kind: "number", value }, pattern, host)).toEqual({ kind: "string", value: expected });
});

it("preserves cancellation during format scanning", () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  expect(() => formatText({ kind: "number", value: 12 }, "0.00", {
    ...host, context: { ...context, signal: controller.signal }, tick() { controller.signal.throwIfAborted(); }
  })).toThrow("cancelled");
});

it.each([
  ['"pre"@"post"', "prehellopost"], ['0;0;0;"pre"@"post"', "prehellopost"],
  ["0.00", "hello"], ['"literal"', "hello"], ['0;0;0;"literal"', "hello"],
  ['@"x"@', "helloxhello"], ["0;0;0;0", "hello"], ["0\\@", "hello"], ["0;0;0;", ""]
])("matches native string TEXT section %s", (pattern, expected) => {
  expect(formatText({ kind: "string", value: "hello" }, pattern, host)).toEqual({ kind: "string", value: expected });
});

it.each<[number, string, string]>([
  [1.2, "0.#0", "1.20"], [1, "0.#0", "1.0"], [1.02, "0.#0", "1.02"],
  [1.2, "0.0#0", "1.20"], [1, "0.0#0", "1.00"], [1.2, "0.?0", "1.20"],
  [1, "0.?0", "1. 0"], [1, "0.#?0", "1. 0"], [1.002, "0.#?0", "1.002"], [0, "#.##0", ".0"]
])("matches fresh mixed fractional native TEXT(%s,%s)", (value, pattern, expected) => {
  expect(formatText({ kind: "number", value }, pattern, host)).toEqual({ kind: "string", value: expected });
});

it.each([
  ['1.234,50', '0,00', '1234,50'], ['1234,5', '0,00', '1234,50'], ['1,234', '0,000', '1,234'],
  ['WAHR', '0,00', 'WAHR'], ['FALSCH', '0,00', 'FALSCH'], ['1.234,50', '"x"@', '1234,5'],
  ['1.234,50', '#.##0,00', '1.234,50'], ['1,2', '0,#0', '1,20'], ['12.5', '0,00', '12.5']
])("matches fresh German string TEXT(%s,%s)", (value, pattern, expected) => {
  const literal = (text: string) => '"' + text.split('\\').join('\\\\').split('"').join('\\"') + '"';
  const book = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0,
    value: { kind: "number" as const, value: 0 }, formula: `=TEXT(${literal(value)},${literal(pattern)})`, formulaDirty: true }] }] };
  expect(recalculateWorkbook(book, { ...context, environment: { ...context.environment, locale: "de_DE.UTF-8" } }).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: expected });
});

it.each<[number, string, string]>([
  [2.5, "0", "3"], [3.5, "0", "4"], [-2.5, "0", "-3"], [-3.5, "0", "-4"],
  [.125, "0.00", "0.13"], [.375, "0.00", "0.38"],
  [1e-110, "0." + "0".repeat(115), "0." + "0".repeat(109) + "100000"],
  [1e-110, "0." + "0".repeat(110), "0." + "0".repeat(109) + "1"],
  [1.234e-110, "0." + "0".repeat(115), "0." + "0".repeat(109) + "123400"]
])("matches native halfway and long precision TEXT(%s,%s)", (value, pattern, expected) => {
  expect(formatText({ kind: "number", value }, pattern, host)).toEqual({ kind: "string", value: expected });
});
