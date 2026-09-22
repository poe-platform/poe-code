import { perlSedLookbehindCases, perlSedInvalidLookbehindByteCases } from "./perl-sed-lookbehind-fixtures.js";
import { perlSedCaptureCases, perlSedInvalidCaptureByteCases, perlSedCaptureHoldouts } from "./perl-sed-capture-fixtures.js";
import { expect, it } from "vitest";
import { perlSedCases, perlSedInvalidByteCases } from "./perl-sed-fixtures.js";
import proof from "../../../../docs/ssconvert/perl-sed-applicability.json" with { type: "json" };
import { quoteFormulaString } from "./serialization.js";
import { gnumericGrammar } from "./conventions.js";
import { perlSed } from "./functions/perl-sed.js";
import type { FunctionHost } from "./functions/types.js";
import type { CellValue } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import { perlSampleFunctions } from "./optional-providers.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  runtimeFunctions: perlSampleFunctions, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 1000 } };
const decode = (hex: string) => new TextDecoder("UTF-8", { fatal: true }).decode(Uint8Array.from(hex.match(/../g) ?? [], value => parseInt(value, 16)));
const expression = (values: readonly string[]) => '=PERL_SED(' + values.map(value => quoteFormulaString(value, '"', gnumericGrammar)).join(',') + ')';
function calculate(formula: string, supplied = context) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, supplied).sheets[0]!.cells[0]!.value;
}
it.each(proof.cases.filter(vector => "outputHex" in vector))("matches unmodified Perl scalar source $id", vector => {
  const formula = expression(vector.argumentsHex.map(decode));
  expect(calculate(formula)).toEqual({ kind: "string", value: decode(vector.outputHex!) });
});
it("keeps optional namespace and declared three-string arity", () => {
  expect(calculate('=PERL_SED("abc","b","d")', { ...context, runtimeFunctions: {} })).toEqual({ kind: "error", value: "#NAME?" });
  expect(calculate('=PERL_SED("abc","b")')).toEqual({ kind: "error", value: "#N/A" });
  expect(calculate('=PERL_SED("abc","b","d","extra")')).toEqual({ kind: "error", value: "#N/A" });
});

it.each(perlSedCases)("matches independent ordered regex source $id", vector => {
  const formula = expression(vector.argumentsHex.map(decode));
  expect(calculate(formula)).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it("keeps native C-string input boundaries and literal replacement output", () => {
  const values = ["abc\0b", "b", "$1\0tail"];
  const book = { sheets: [{ id: "s", name: "S", cells: [
    ...values.map((value, column) => ({ row: 0, column, value: { kind: "string" as const, value } })),
    { row: 0, column: 3, value: { kind: "blank" as const }, formula: "=PERL_SED(A1,B1,C1)", formulaDirty: true }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[3]!.value).toEqual({ kind: "string", value: "a$1c" });
});
it("refuses unsafe or unqualified pattern execution explicitly", () => {
  for (const pattern of ['(?{die "owned unsafe code"})', '(??{die "owned unsafe code"})', '(a)\\11', '(?<=a+)b'])
    expect(() => calculate(expression(["aab", pattern, "X"]))).toThrow("PERL_SED pattern syntax or diagnostic");
});
it("bounds output amplification and ordered backtracking work", () => {
  expect(() => calculate('=PERL_SED("aaaa","","XXXXXXXX")', { ...context, limits: { ...context.limits, outputBytes: 8 } })).toThrow("text limit exceeded");
  expect(() => calculate('=PERL_SED("aaaaaaaaaaaaaaaaaaaa","(a|aa)*b","X")', { ...context, limits: { ...context.limits, workbookWork: 200 } })).toThrow("work limit");
  const host = { context: { ...context, limits: { ...context.limits, inputBytes: 3 } }, tick() {},
    scalar(value: CellValue) { return value; } } as unknown as FunctionHost;
  expect(() => perlSed(["abc", "a", "X"].map(value => ({ kind: "string", value })), host)).toThrow("input byte limit");
});
it("observes cancellation within matching without more ticks", () => {
  const signal = new AbortController().signal; let checks = 0;
  const original = signal.throwIfAborted.bind(signal);
  signal.throwIfAborted = () => { original(); if (++checks === 100) throw new DOMException("Aborted", "AbortError"); };
  expect(() => calculate('=PERL_SED("aaaaaaaaaaaaaaaaaaaa","(a|aa)*b","X")', { ...context, signal })).toThrow("Aborted");
  expect(checks).toBe(100);
});

it.each(perlSedInvalidByteCases)("refuses unresolved native byte-result representation $id", vector => {
  expect(() => calculate(expression(vector.argumentsHex.map(decode)))).toThrow("PERL_SED byte result representation");
});

it.each(perlSedCaptureCases)("matches independent native capture state $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});

it.each(perlSedInvalidCaptureByteCases)("refuses unresolved capture byte result $id", vector => {
  expect(() => calculate(expression(vector.argumentsHex.map(decode)))).toThrow("PERL_SED byte result representation");
});

it.each(perlSedCaptureHoldouts)("matches independent capture holdout $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});

it.each(perlSedLookbehindCases)("matches independent fixed lookbehind $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it.each(perlSedInvalidLookbehindByteCases)("refuses unresolved lookbehind byte result $id", vector => {
  expect(() => calculate(expression(vector.argumentsHex.map(decode)))).toThrow("PERL_SED byte result representation");
});
