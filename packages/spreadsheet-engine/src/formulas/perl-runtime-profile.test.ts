import { perl540Cases } from "./perl-540-fixtures.js";
import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
import { createPerlSampleFunctions, perlSampleFunctions } from "./optional-providers.js";
import { quoteFormulaString } from "./serialization.js";
import { gnumericGrammar } from "./conventions.js";
const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 10000 } };
const cases = [
  ["ababb", "(?<=a{1,3})b", "aXaXX", "aXaXb"],
  ["ababb", "(?<!a{1,3})b", "ababb", "ababX"],
  ["abab", "(?:(a)|b)+\\1", "Xb", "abab"],
  ["abab", "((a)|(b))+\\2", "Xb", "abab"]
] as const;
for (const version of ["5.34.1", "5.40.1"] as const)
it.each(cases)(`${version} matches native profile for %s / %s`, (source, pattern, legacy, modern) => {
  const formula = "=PERL_SED(" + [source, pattern, "X"].map(value => quoteFormulaString(value, '"', gnumericGrammar)).join(",") + ")";
  const book = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" as const } }] }] };
  expect(recalculateWorkbook(book, { ...context, runtimeFunctions: createPerlSampleFunctions({ version }) }).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: version === "5.34.1" ? legacy : modern });
  expect(recalculateWorkbook(book, { ...context, runtimeFunctions: perlSampleFunctions }).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "string", value: legacy });
});
it("rejects unknown Perl profiles explicitly", () => {
  expect(() => createPerlSampleFunctions({ version: "latest" as "5.40.1" })).toThrow("Unsupported Perl version");
});

it.each(perl540Cases)("matches independent 5.40 byte output for %s / %s", (source, pattern, replacement, expectedHex) => {
  const formula = "=PERL_SED(" + [source, pattern, replacement].map(value => quoteFormulaString(value, '"', gnumericGrammar)).join(",") + ")";
  const book = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" as const } }] }] };
  const value = recalculateWorkbook(book, { ...context, runtimeFunctions: createPerlSampleFunctions({ version: "5.40.1" }) }).sheets[0]!.cells[0]!.value;
  expect(value.kind === "string" ? Buffer.from(value.value).toString("hex") : value.kind === "byte-string" ? value.value : value).toBe(expectedHex);
});

it("bounds work and preserves cancellation in the 5.40 profile", () => {
  const book = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
    formula: '=PERL_SED("aaaaaaaaaaaaaaaaaaaa","(a|aa)*b","X")', formulaDirty: true, value: { kind: "blank" as const } }] }] };
  const configured = { ...context, runtimeFunctions: createPerlSampleFunctions({ version: "5.40.1" }) };
  expect(() => recalculateWorkbook(book, { ...configured, limits: { ...context.limits, workbookWork: 200 } })).toThrow("work limit");
  const signal = new AbortController().signal;
  const original = signal.throwIfAborted.bind(signal);
  const reason = new Error("cancel modern matcher"); let checks = 0;
  signal.throwIfAborted = () => { original(); if (++checks === 100) throw reason; };
  expect(() => recalculateWorkbook(book, { ...configured, signal })).toThrow(reason);
  expect(checks).toBe(100);
});
