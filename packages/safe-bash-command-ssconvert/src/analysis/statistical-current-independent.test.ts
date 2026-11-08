import { expect, it } from "vitest";
import { analyze } from "./moments.test.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { prepareToolTest } from "./protocol.js";
import { runAnalysisTool } from "./run.js";

it("advanced-filter folds ASCII field letters without folding non-ASCII field letters", async () => {
  const invalid = await analyze("advanced-filter", ["x:A1:A3", "y:C1:C2"], [["Ärea", "", "ärea"], [1, "", ">0"], [2]]);
  expect(invalid.cell(3, 0)?.value).toEqual({ kind: "string", value: "The given criteria are invalid." });
  expect(invalid.cell(4, 0)).toBeUndefined();
  const valid = await analyze("advanced-filter", ["x:A1:A3", "y:C1:C2"], [["ÄREA", "", "Ärea"], [1, "", ">0"], [2]]);
  expect(valid.cell(4, 0)?.value).toEqual({ kind: "number", value: 1 });
  expect(valid.cell(5, 0)?.value).toEqual({ kind: "number", value: 2 });
});

it("advanced-filter treats a present empty-string criterion as a blank-value condition", async () => {
  const output = await analyze("advanced-filter", ["x:A1:A3", "y:C1:C2"], [["Score", "", "Score"], ["filled", "", ""], [""]]);
  expect(output.cell(4, 0)?.value).toEqual({ kind: "string", value: "" });
  expect(output.cell(5, 0)).toBeUndefined();
});

it("advanced-filter snaps a numeric field index one binary64 step below an integer", async () => {
  const output = await analyze("advanced-filter", ["x:A1:A3", "y:C1:C2"], [["Score", "", 0.9999999999999999], [1, "", ">1"], [2]]);
  expect(output.cell(4, 0)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(5, 0)).toBeUndefined();
});

it("unequal and equal t-tests preserve independent unequal sample sizes", async () => {
  const rows = [[1, 2], [3, 4], [5, 8], ["ignored", 10]];
  const equal = await analyze("t-test-equal-variances", ["x:$A$1:$A$4", "y:$B$1:$B$4"], rows);
  expect(equal.cell(3, 1)?.value).toEqual({ kind: "number", value: 3 });
  expect(equal.cell(3, 2)?.value).toEqual({ kind: "number", value: 4 });
  expect((equal.cell(4, 1)?.value as { value: number }).value).toBeCloseTo(48 / 5, 12);
  expect(equal.cell(7, 1)?.value).toEqual({ kind: "number", value: 5 });
  const unequal = await analyze("t-test-unequal-variances", ["x:$A$1:$A$4", "y:$B$1:$B$4"], rows);
  expect((unequal.cell(6, 1)?.value as { value: number }).value).toBeCloseTo(147 / 31, 12);
});

const tools = ["chi-squared-test", "sign-test", "sign-test-two-samples", "one-mean-test", "wilcoxon-signed-rank-test",
  "wilcoxon-signed-rank-test-two-samples", "wilcoxon-mann-whitney", "f-test", "t-test-paired", "t-test-equal-variances",
  "t-test-unequal-variances", "kaplan-meier", "z-test", "advanced-filter", "fill-series"];
it.each(tools)("%s preserves the input on cancellation and output-budget failure", async tool => {
  const book: Workbook = { activeSheet: "s", sheets: [{ id: "s", name: "Input", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 } },
    { row: 0, column: 1, value: { kind: "number", value: 2 } },
    { row: 1, column: 0, value: { kind: "number", value: 3 } },
    { row: 1, column: 1, value: { kind: "number", value: 4 } }
  ] }] };
  const original = structuredClone(book);
  const controller = new AbortController();
  const context: CapabilityContext = { signal: controller.signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 10, operations: 100000 } };
  const request = await prepareToolTest(book, [tool, "data:$A$1:$B$2", "x:$A$1:$A$2", "y:$B$1:$B$2", "step-value:1", "stop-value:4"], context);
  await expect(runAnalysisTool(book, request, { ...context, limits: { ...context.limits, operations: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
  expect(book).toEqual(original);
  const reason = new Error("independent cancellation");
  controller.abort(reason);
  await expect(runAnalysisTool(book, request, context)).rejects.toBe(reason);
  expect(book).toEqual(original);
});
