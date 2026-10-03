import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { createPerlSampleFunctions } from "./optional-providers.js";
import { quoteFormulaString } from "./serialization.js";
import { gnumericGrammar } from "./conventions.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 10000 } };
// Independently identical native Perl 5.34.1 and 5.40.1 byte results.
const cases = [
  ["aab", "a\\Kb", "616158"],
  ["aab", "a\\K", "6158615862"],
  ["aab", "a?\\K", "615861586258"],
  ["aab", "\\K", "58615861586258"],
  ["aab", "(a\\Kb|ac)", "616158"],
  ["aab", "(a\\K)*", "6161586258"],
  ["aab", "(a\\K)+", "61615862"],
  ["aab", "a+\\K", "61615862"],
  ["aab", "a+?\\K", "6158615862"],
  ["aab", "a\\K|b", "6158615858"],
  ["aab", "a\\Kb|a", "586158"],
  ["aab", "(a)\\K\\1", "615862"],
  ["aab", "a\\Kb\\K", "61616258"],
  ["aab", "a\\K(b|c)", "616158"],
  ["aab", "(?:a\\Kx|a)b", "6158"],
  ["aab", "a\\K(?:b|)", "61586158"],
  ["aab", "a\\K(?=b)", "61615862"],
  ["aab", "a\\K(?!c)", "6158615862"],
  ["ac", "(a\\Kb|ac)", "58"],
  ["abac", "(?:a\\Kx|a)b", "586163"],
  ["", "\\K", "58"],
  ["aba", "(a\\K|b)+", "61626158"],
  ["aaaa", "(a\\K)+a", "6161616158"],
  ["aaaa", "(a\\K)+?a", "61586158"],
  ["a\nb", "(?s).\\K.", "615862"],
  ["\u00e4a", ".\\Ka", "c3a458"],
  ["aaaa", "(a\\K)+b|a+", "6161616158"],
  ["aaaa", "(a\\K){1,3}b|a+", "61616158"],
  ["aaaa", "a+\\Kb|a+", "58"],
  ["aaaa", "(a\\K)+aa", "6161616158"],
  ["aaaa", "(a\\Kx)*", "586158615861586158"],
  ["aaaa", "(a\\Kx)+|a", "58585858"],
  ["aaaa", "(?:a\\Kx|a)+", "58"],
  ["aaaa", "(?:a\\K|b)+a", "6161616158"],
  ["aaaa", "(?:a\\K){0}a", "58585858"],
  ["aaaa", "(?:a\\K)?b|a", "6158615861586158"],
  ["aaaa", "(?:a\\K)*\\Ka", "61616158"],
  ["aaaa", "(?:a\\K)+\\Ka", "61616158"],
  ["aaaa", "(a\\K)+?b|a+", "6161616158"],
  ["aaaa", "(a\\K){2,4}?a", "61615861"],
  ["aaaa", "a(?:b\\K|a)+a", "58"],
  ["aaaa", "(?:a\\Kb|a\\Kc)+a", "61616161"],
  ["aaaa", "(?>a\\K)+a", "6161616158"],
  ["aaaa", "(a\\K)+(?=a)", "616161615861"],
  ["aaaa", "(a\\K)+a?", "6161616158"],
  ["aaaa", "(a\\K)+a{2}", "6161616158"],
  ["aaaa", "(a\\K)+\\K(?=a)", "6161615861"],
  ["aaaa", "(a\\K)+(?=aa)|a", "61616161586161586158"],
  ["aaaa", "(a\\K){1,3}\\K(?=a)", "6161615861"],
  ["aa", "(a\\K|ab\\K)+a", "6158"],
  ["aab", "(a\\K|ab\\K)+a", "615862"],
  ["aaaa", "(a\\K|ab\\K)+a", "61616158"],
  ["abab", "(a\\K|ab\\K)+a", "61625862"],
  ["aaaa", "((a\\K)+b|a)+", "6161616158"],
  ["aaaa", "(?:(a\\K)+b|a)+\\K", "6161616158"],
  ["aaaa", "(a\\K)+?\\K(?=a)", "61586158615861"],
  ["aaaa", "((a)\\K)+a", "61616158"],
  ["aaaa", "(a(\\K))+a", "61616158"],
  ["aaaa", "(?:(a)\\K)+a", "61616158"],
  ["aaaa", "(?:a\\K){2}+a", "61615861"],
  ["aaaa", "(?:(?:a\\K)){1,3}a", "61616158"],
  ["aaaa", "(a\\K|b\\K)+a", "6161616158"],
  ["aaaa", "(?:a\\K(?=a))+a", "61616158"],
  ["aaaa", "(?:a\\K(?=(a)))+a", "61616158"],
  ["aaaa", "(?:a\\K?)+a", "6161616158"],
  ["aaaa", "(?:a\\K){2}a", "61615861"]
] as const;
for (const version of ["5.34.1", "5.40.1"] as const) {
  it.each(cases)(`${version} preserves reset prefixes for %s / %s`, (source, pattern, expectedHex) => {
    const formula = "=PERL_SED(" + [source, pattern, "X"].map(value => quoteFormulaString(value, '"', gnumericGrammar)).join(",") + ")";
    const book = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" as const } }] }] };
    const value = recalculateWorkbook(book, { ...context, runtimeFunctions: createPerlSampleFunctions({ version }) }).sheets[0]!.cells[0]!.value;
    expect(value.kind === "string" ? Buffer.from(value.value).toString("hex") : value.kind === "byte-string" ? value.value : value).toBe(expectedHex);
  });
  it.each([String.raw`(?=a\K)`, String.raw`(?<=a\K)b`, String.raw`(?!a\K)`, String.raw`(?<!a\K)b`])(`${version} refuses reset in lookarounds: %s`, pattern => {
    const formula = "=PERL_SED(" + ["ab", pattern, "X"].map(value => quoteFormulaString(value, '"', gnumericGrammar)).join(",") + ")";
    const book = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" as const } }] }] };
    expect(() => recalculateWorkbook(book, { ...context, runtimeFunctions: createPerlSampleFunctions({ version }) })).toThrow("Unsupported ssconvert feature: PERL_SED");
  });
}

it("bounds reset repetition and preserves the original cancellation reason", () => {
  const book = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
    formula: '=PERL_SED("aaaaaaaaaaaaaaaaaaaa","(a\\\\K|aa)*b","X")', formulaDirty: true, value: { kind: "blank" as const } }] }] };
  for (const version of ["5.34.1", "5.40.1"] as const) {
    const configured = { ...context, runtimeFunctions: createPerlSampleFunctions({ version }) };
    expect(() => recalculateWorkbook(book, { ...configured, limits: { ...context.limits, workbookWork: 200 } })).toThrow("work limit");
    const signal = new AbortController().signal;
    const original = signal.throwIfAborted.bind(signal);
    const reason = new Error("cancel reset matcher"); let checks = 0;
    signal.throwIfAborted = () => { original(); if (++checks === 100) throw reason; };
    expect(() => recalculateWorkbook(book, { ...configured, signal })).toThrow(reason);
    expect(checks).toBe(100);
  }
});
