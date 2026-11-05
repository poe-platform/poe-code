import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 10000 } };
function calculate(formula: string, supplied = context) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, supplied).sheets[0]!.cells[0]!.value;
}

it.each([
  ['=REGEXREPLACE("abc123","[0-9]+","X")', "abcX"],
  ['=REGEXREPLACE("a1b2","[0-9]","X")', "aXbX"],
  ['=REGEXREPLACE("abc","z","X")', "abc"],
  ['=REGEXREPLACE("aaaa","aa","X")', "XX"],
  ['=REGEXREPLACE("a1b2","[0-9]","X",2)', "a1bX"],
  ['=REGEXREPLACE("a1b2","[0-9]","X",-1)', "a1bX"],
  ['=REGEXREPLACE("a1b2","[0-9]","X",-3)', "a1b2"],
  ['=REGEXREPLACE("aAb","a","X",0,TRUE)', "XXb"],
  ['=REGEXREPLACE("a1b2","([a-z])([0-9])","$2$1")', "1a2b"],
  ['=REGEXREPLACE("ab","a","😀")', "😀b"],
  ['=REGEXREPLACE("ab","","X")', "XaXbX"],
  ['=REGEXREPLACE("a1b2","[0-9]","")', "ab"],
  ['=REGEXREPLACE("a1b2","[0-9]","é")', "aébé"],
])("replaces globally for %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "string", value });
});
it("retains unknown-function and error propagation behavior", () => {
  expect(calculate('=REGEXMATCH("abc123","[0-9]+")')).toEqual({ kind: "error", value: "#NAME?" });
  expect(calculate('=REGEXREPLACE(1/0,"a","X")')).toEqual({ kind: "error", value: "#DIV/0!" });
  expect(calculate('=REGEXREPLACE("a","a")')).toEqual({ kind: "error", value: "#N/A" });
});
it("bounds matching work and replacement output", () => {
  expect(() => calculate('=REGEXREPLACE("aaaaaaaaaaaaaaaaaaaa","(a|aa)*b","X")',
    { ...context, limits: { ...context.limits, workbookWork: 200 } })).toThrow("work limit");
  expect(() => calculate('=REGEXREPLACE("aaaa","a","xxxxxxxx")',
    { ...context, limits: { ...context.limits, outputBytes: 20 } })).toThrow("text limit");
});

it("rejects matching outside the admitted ASCII profile explicitly", () => {
  expect(() => calculate('=REGEXREPLACE("é",".","X")')).toThrow("REGEXREPLACE Unicode matching");
});
it("preserves cancellation during matching", () => {
  const signal = new AbortController().signal;
  const reason = new Error("cancel regex replacement");
  let checks = 0;
  signal.throwIfAborted = () => { if (++checks === 100) throw reason; };
  expect(() => calculate('=REGEXREPLACE("aaaaaaaaaaaaaaaaaaaa","(a|aa)*b","X")', { ...context, signal })).toThrow(reason);
});
