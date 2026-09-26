import { expect, it } from "vitest";
import { analyze } from "./moments.test.js";

it.each([
  ["wilcoxon-signed-rank-test", ["data:A1:A4"], "B9", "This p-value is calculated by a normal approximation.\nIt is only valid if the sample size is at least 12."],
  ["wilcoxon-signed-rank-test-two-samples", ["x:A1:A4", "y:B1:B4"], "B10", "This p-value is calculated by a normal approximation.\nIt is only valid if the sample size is at least 12."],
  ["chi-squared-test", ["data:A1:B4"], "A5", "α = 0.05"],
] as const)("retains source warning comments for %s", async (tool, properties, bound, text) => {
  const output = await analyze(tool, [...properties]);
  expect(output.sheet.unsupportedRecords).toContainEqual({ source: "Gnumeric_XmlIO:sax", kind: "CellComment", disposition: "retained", data: { ObjectBound: bound, ObjectOffset: "1 0 1 0", Direction: "17", Print: "1", Text: text } });
});

it("chi-squared alpha comments retain C fixed-decimal ties-to-even", async () => {
  const output = await analyze("chi-squared-test", ["data:A1:B4", "alpha:0.125"]);
  expect(output.sheet.unsupportedRecords?.find(record => record.kind === "CellComment")?.data).toMatchObject({ Text: "α = 0.12" });
});

it("fills numeric series in the requested orientation", async () => {
  const output = await analyze("fill-series", ["start-value:2", "step-value:3", "stop-value:11", "series-in-rows:yes"]);
  expect(output.sheet.cells.map(cell => cell.value)).toEqual([2,5,8,11].map(value => ({ kind: "number", value })));
});

it("filters records by criteria and retains source order", async () => {
  const output = await analyze("advanced-filter", ["x:A1:B4", "y:D1:D2"], [["Name","Score","","Score"],["Ada",4,"",">3"],["Bo",2],["Cy",6]]);
  expect(output.cell(4, 0)?.value).toEqual({ kind: "string", value: "Ada" });
  expect(output.cell(5, 0)?.value).toEqual({ kind: "string", value: "Cy" });
});

it("generates survival estimates with censoring and the source standard error", async () => {
  const output = await analyze("kaplan-meier", ["x:$A$1:$A$4", "y:$B$1:$B$4", "censored:yes", "censor-mark:1", "censor-mark-to:1", "std-err:yes"], [[1,0],[2,1],[3,0],[4,0]]);
  expect(output.cell(3, 4)?.value).toEqual({ kind: "number", value: 0.75 });
  expect(output.cell(4, 4)?.value).toEqual({ kind: "number", value: 0.75 });
  expect(output.cell(5, 4)?.value).toEqual({ kind: "number", value: 0.375 });
});

it("Kaplan-Meier uncensored deaths preserve released expression parentheses", async () => {
  const output = await analyze("kaplan-meier", ["x:$A$1:$A$4", "y:$B$1:$B$4"]);
  expect(output.cell(2, 2)?.formula).toBe('=if(B3="","",sum(1*if(Input!$A$1:$A$4=A3,1,0)))');
});

it.each(["sign-test-two-samples", "wilcoxon-signed-rank-test-two-samples", "wilcoxon-mann-whitney"])("executes paired rank tool %s", async tool => {
  const output = await analyze(tool, ["x:A1:A4", "y:B1:B4"]);
  expect(output.sheet.name).toContain(tool === "sign-test-two-samples" ? "Sign Test" : "Wilcoxon");
  expect(output.cell(tool === "wilcoxon-mann-whitney" ? 3 : tool === "sign-test-two-samples" ? 4 : 4, 1)?.value).toEqual({ kind: "number", value: 4 });
});

it("generates signed ranks and the released small-sample warning value", async () => {
  const output = await analyze("wilcoxon-signed-rank-test", ["data:A1:A4", "median:3"]);
  expect(output.cell(3, 1)?.value).toEqual({ kind: "number", value: 3 });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "number", value: 4.5 });
  expect(output.cell(8, 1)?.value).toEqual({ kind: "error", value: "#N/A" });
});

it.each([
  ["t-test-paired", 8, 3],
  ["t-test-equal-variances", 7, 6],
  ["t-test-unequal-variances", 6, 75 / 17],
  ["f-test", 5, 0.25],
  ["z-test", 6, -2.5],
] as const)("executes %s with its specific variance model", async (tool, row, value) => {
  const output = await analyze(tool, ["x:$A$1:$A$4", "y:$B$1:$B$4", "var1:1", "var2:3"]);
  expect((output.cell(row, 1)?.value as { value: number }).value).toBeCloseTo(value, 12);
});

it("z-test retains the released relative input axes at each output position", async () => {
  const output = await analyze("z-test", ["x:A1:A4", "y:B1:B4"], [[1,2],[2,5],[4,6],[7,9]]);
  expect(output.cell(1, 1)?.formula).toBe("=average(Input!B2:B5)");
  expect(output.cell(3, 2)?.formula).toBe("=count(Input!D4:D7)");
  expect(output.cell(1, 2)?.value).toEqual({ kind: "error", value: "#DIV/0!" });
});

it("chi-squared preserves the released statistic expression structure", async () => {
  const output = await analyze("chi-squared-test", ["data:A1:B2"], [[12,18],[8,22]]);
  expect(output.cell(1, 1)?.formula).toContain("-mmult(");
  expect(output.cell(1, 1)?.formula).not.toContain("-(mmult(");
});

it("executes the released one-mean test with cleaned arrays and linked hypotheses", async () => {
  const output = await analyze("one-mean-test", ["data:A1:B4", "mean:2"]);
  expect(output.cell(5, 1)?.formula).toBe("=(B3-B4)/sqrt(B5/B2)");
  expect(output.cell(3, 2)?.formula).toBe("=B4");
  expect(output.cell(6, 1)?.value).toEqual({ kind: "number", value: 3 });
});

it("executes sign tests excluding values equal to the hypothesized median", async () => {
  const output = await analyze("sign-test", ["data:A1:A4", "median:2"]);
  expect(output.cell(3, 1)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "number", value: 3 });
  expect(output.cell(7, 1)?.formula).toBe("=2*B7");
});

it("executes a chi-squared contingency test", async () => {
  const output = await analyze("chi-squared-test", ["data:A1:B2"], [[12,18],[8,22]]);
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: 1 });
  expect((output.cell(1, 1)?.value as { value: number }).value).toBeCloseTo(1.2, 12);
});
