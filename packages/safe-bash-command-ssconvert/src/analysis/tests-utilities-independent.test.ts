import { expect, it } from "vitest";
import { analyze } from "./moments.test.js";

it.each(["t-test-paired", "t-test-equal-variances", "t-test-unequal-variances", "f-test"])("%s uses the source label axis for a wide multirow range", async tool => {
  const output = await analyze(tool, ["x:A1:C2", "y:A3:C4", "labels:yes"], [["first", 1, 3], ["unused", 5, 7], ["second", 2, 4], ["unused", 6, 8]]);
  expect(output.cell(0, 1)?.formula).toBe("=Input!$A$1");
  expect(output.cell(0, 2)?.formula).toBe("=Input!$A$3");
  expect(output.cell(1, 1)?.formula).toBe("=average(Input!$B$1:$C$2)");
  expect(output.cell(1, 1)?.value).toEqual({ kind: "number", value: 4 });
  expect(output.cell(3, 1)?.value).toEqual({ kind: "number", value: 4 });
});

it("z-test writes direct labels while retaining its source range before label mutation", async () => {
  const output = await analyze("z-test", ["x:$A$1:$C$2", "y:$A$3:$C$4", "labels:yes"], [["first", 1, 3], ["unused", 5, 7], ["second", 2, 4], ["unused", 6, 8]]);
  expect(output.cell(0, 1)?.formula).toBe("=Input!$A$1");
  expect(output.cell(1, 1)?.formula).toBe("=average(Input!$A$1:$C$2)");
  expect(output.cell(1, 1)?.value).toEqual({ kind: "number", value: 4 });
});

it.each([["yes", "Independence"], ["no", "Homogeneity"]])("chi-squared retains its expected-count warning for independence=%s", async (independence, title) => {
  const output = await analyze("chi-squared-test", ["data:A1:B2", `independence:${independence}`], [[1, 1], [1, 1]]);
  expect(output.cell(0, 0)?.format).toBe(`[>=5]"Test of ${title}";[<5][Red]"Invalid Test of ${title}"`);
  expect(output.cell(0, 0)?.style).toMatchObject({ italic: true, horizontalAlignment: "center", verticalAlignment: "bottom" });
  expect(output.cell(0, 0)?.value).toEqual({ kind: "number", value: 1 });
});

it("sign-test retains a two-tailed array expression, including the released probability above one", async () => {
  const output = await analyze("sign-test", ["data:A1:A4", "median:0"], [[-2], [-1], [1], [2]]);
  const cell = output.cell(7, 1)!;
  expect(cell.formula).toBe("=2*B7");
  expect(cell.formulaGroup).toBeDefined();
  expect(output.sheet.formulaGroups?.find(group => group.id === cell.formulaGroup)?.range).toEqual({ startRow: 7, endRow: 7, startColumn: 1, endColumn: 1 });
  expect(cell.value.kind).toBe("number");
  expect((cell.value as { value: number }).value).toBeCloseTo(1.375, 12);
});

it("paired t-test counts only numeric pairs while preserving separate sample counts", async () => {
  const output = await analyze("t-test-paired", ["x:A1:A4", "y:B1:B4"], [[1, 2], ["excluded", 7], [4, "excluded"], [5, 8]]);
  expect(output.cell(3, 1)?.value).toEqual({ kind: "number", value: 3 });
  expect(output.cell(3, 2)?.value).toEqual({ kind: "number", value: 3 });
  expect(output.cell(6, 1)?.value).toEqual({ kind: "number", value: -2 });
  expect(output.cell(7, 1)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(8, 1)?.value).toEqual({ kind: "number", value: 1 });
});

it("one-mean test groups rows and links hypothesis parameters after skipping labels", async () => {
  const output = await analyze("one-mean-test", ["data:A1:D2", "group-by:row", "labels:yes", "mean:2", "alpha:0.1"], [["one", 1, 2, 3], ["two", 3, 5, 7]]);
  expect(output.cell(0, 1)?.formula).toBe("=Input!$A$1");
  expect(output.cell(0, 2)?.formula).toBe("=Input!$A$2");
  expect(output.cell(1, 1)?.value).toEqual({ kind: "number", value: 3 });
  expect(output.cell(5, 1)?.value).toEqual({ kind: "number", value: 0 });
  expect(output.cell(3, 2)?.formula).toBe("=B4");
  expect(output.cell(7, 2)?.formula).toBe("=B8");
});

it("Mann-Whitney combines adjacent sample ranges as a single area", async () => {
  const output = await analyze("wilcoxon-mann-whitney", ["x:A1:A4", "y:B1:B4"]);
  expect(output.cell(3, 3)?.formula).toBe("=count(Input!$A$1:$B$4)");
});

it("Mann-Whitney combines separated ranges with ARRAY rather than SET", async () => {
  const output = await analyze("wilcoxon-mann-whitney", ["x:A1:A2", "y:B3:B4"]);
  expect(output.cell(3, 3)?.formula).toBe("=count(array(Input!$A$1:$A$2,Input!$B$3:$B$4))");
});

it("Kaplan median and logrank output retain the released header/value geometry", async () => {
  const output = await analyze("kaplan-meier", ["x:A1:A4", "median:yes", "logrank-test:yes"]);
  expect(output.cell(1, 5)?.value).toEqual({ kind: "string", value: "Median" });
  expect(output.cell(1, 6)?.formula).toBeDefined();
  expect(output.cell(5, 5)?.value).toEqual({ kind: "string", value: "Log-Rank Test" });
  expect(output.cell(6, 6)?.formulaGroup).toBeDefined();
  expect(output.cell(7, 6)?.value).toEqual({ kind: "number", value: 0 });
});

import { sheetObjects } from "../objects/index.js";
import type { CapabilityContext } from "../contracts.js";
const objectContext: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10000, sheets: 10, operations: 1000000 } };

it("Kaplan charts retain probability and censor tick series in the workbook object model", async () => {
  const output = await analyze("kaplan-meier", ["x:$A$1:$A$4", "y:$B$1:$B$4", "censored:yes", "chart:yes", "ticks:yes"], [[1, 0], [2, 1], [3, 0], [4, 1]]);
  const chart = sheetObjects(output.sheet, objectContext)[0]!;
  expect(chart.anchor.range).toEqual({ startRow: 1, startColumn: 0, endRow: 20, endColumn: 5 });
  const plot = chart.graph!.children[0]!.children.find(child => child.role === "Plot")!;
  expect(plot.type).toBe("GogXYPlot");
  expect(plot.properties.find(property => property.attributes.name === "interpolation")?.text).toBe("step-start");
  expect(plot.children).toHaveLength(2);
  expect(plot.children[0]!.data.map(data => data.expression)).toEqual(["'Kaplan-Meier Estimates (1)'!$A$3:$A$6", "'Kaplan-Meier Estimates (1)'!$E$3:$E$6"]);
  expect(plot.children[1]!.data[1]!.expression).toBe("$E$3:$E$6/$D$3:$D$6*$D$3:$D$6");
  expect(plot.children[1]!.style?.marker?.shape).toBe("triangle-down");
});

it("Kaplan preserves relative input axes separately at each generated array cell", async () => {
  const output = await analyze("kaplan-meier", ["x:A1:A4", "y:B1:B4", "censored:yes"]);
  expect(output.cell(2, 1)?.formula).toBe('=if(A3="","",sum(if(Input!B3:B6<A3,0,1)*1))');
  expect(output.cell(3, 0)?.formula).toBe('=if(iserror(small(if(Input!A4:A7>A3,Input!A4:A7,"N/A"),1)),"",small(if(Input!A4:A7>A3,Input!A4:A7,"N/A"),1))');
  expect(output.cell(2, 3)?.formula).toBe('=if(C3="","",sum(1*(if(Input!D3:D6=A3,1,0)*if(Input!E3:E6=0,1,0))))');
});

it("advanced-filter permits numeric criteria fields outside database width", async () => {
  const output = await analyze("advanced-filter", ["x:A1:A4", "y:B1:B4"]);
  expect(output.cell(3, 0)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(6, 0)?.value).toEqual({ kind: "number", value: 4 });
});

it("paired signed-rank preserves the two-tail array and the small-sample error", async () => {
  const output = await analyze("wilcoxon-signed-rank-test-two-samples", ["x:A1:A4", "y:B1:B4"]);
  expect(output.cell(10, 1)?.formulaGroup).toBeDefined();
  expect(output.cell(9, 1)?.value).toEqual({ kind: "error", value: "#N/A" });
});

it("single signed-rank averages tied absolute ranks while excluding the predicted median", async () => {
  const output = await analyze("wilcoxon-signed-rank-test", ["data:A1:A5", "median:0"], [[-2], [-1], [0], [1], [2]]);
  expect(output.cell(3, 1)?.value).toEqual({ kind: "number", value: 4 });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "number", value: 5 });
  expect(output.cell(5, 1)?.value).toEqual({ kind: "number", value: 5 });
  expect(output.cell(8, 1)?.value).toEqual({ kind: "error", value: "#N/A" });
});

it("fill date series preserves the captured native default-date format", async () => {
  const output = await analyze("fill-series", ["type:date", "start-value:45292", "step-value:1", "stop-value:45294"]);
  expect(output.cell(0, 0)?.format).toBe("[$-f8f2]m/d/yy");
  expect(output.cell(2, 0)?.value).toEqual({ kind: "number", value: 45294 });
});

it("Kaplan survival and standard errors retain source number formats", async () => {
  const output = await analyze("kaplan-meier", ["x:$A$1:$A$4", "std-err:yes"]);
  expect(output.cell(2, 3)?.format).toBe("0.00%");
  expect(output.cell(2, 4)?.format).toBe("0.0000");
});

it("advanced-filter applies OR rows, AND columns, stable ordering and unique row values", async () => {
  const output = await analyze("advanced-filter", ["x:A1:B5", "y:D1:E3", "unique-only-flag:yes"],
    [["Name", "Score", "", "Name", "Score"], ["Ada", 4, "", "A", ">3"], ["Bo", 2, "", "B", "<3"], ["Ada", 4], ["Cy", 9]]);
  expect([output.cell(4, 0)?.value, output.cell(5, 0)?.value]).toEqual([{ kind: "string", value: "Ada" }, { kind: "string", value: "Bo" }]);
  expect(output.cell(6, 0)).toBeUndefined();
});

it("advanced-filter preserves source absent-cell condition bypass", async () => {
  const output = await analyze("advanced-filter", ["x:A1:B3", "y:D1:D2"], [["Name", "Score", "", "Score"], ["Ada", 4, "", ">10"], ["Bo"]]);
  expect(output.cell(4, 0)?.value).toEqual({ kind: "string", value: "Bo" });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "blank" });
});

it("fill-series supports growth and explicit setter-state overrides", async () => {
  const growth = await analyze("fill-series", ["type:growth", "start-value:2", "step-value:2", "stop-value:16"]);
  expect([0, 1, 2, 3].map(row => growth.cell(row, 0)?.value)).toEqual([2, 4, 8, 16].map(value => ({ kind: "number", value })));
  const disabled = await analyze("fill-series", ["start-value:7", "step-value:2", "stop-value:15", "is-step-set:no"]);
  expect(disabled.sheet.cells.map(cell => cell.value)).toEqual([{ kind: "number", value: 7 }]);
});

it("fill-series regenerates clipped months from the original start date", async () => {
  const output = await analyze("fill-series", ["type:date", "date-unit:month", "start-value:45322", "step-value:1", "stop-value:45412"]);
  expect(output.sheet.cells.map(cell => cell.value)).toEqual([45322, 45351, 45382, 45412].map(value => ({ kind: "number", value })));
});

it("fill-series weekdays skip the captured weekend gap", async () => {
  const output = await analyze("fill-series", ["type:date", "date-unit:weekday", "start-value:45296", "step-value:1", "stop-value:45303"]);
  expect(output.sheet.cells.map(cell => cell.value)).toEqual([45296, 45299, 45300, 45301, 45302, 45303].map(value => ({ kind: "number", value })));
});

it("Kaplan censors inclusive intervals and ignores inherited labels while starting at zero", async () => {
  const output = await analyze("kaplan-meier", ["x:$A$1:$A$5", "y:$B$1:$B$5", "censored:yes", "censor-mark:1", "censor-mark-to:2", "labels:yes"], [[-1, 1], [0, 0], [1, 1], [1, 2], [2, 3]]);
  expect(output.cell(2, 0)?.value).toEqual({ kind: "number", value: 0 });
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: 4 });
  expect(output.cell(2, 2)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(3, 0)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(3, 2)?.value).toEqual({ kind: "number", value: 0 });
  expect(output.cell(3, 3)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(3, 4)?.value).toEqual({ kind: "number", value: 0.75 });
});

it("advanced-filter unique comparison skips genuinely absent source cells", async () => {
  const output = await analyze("advanced-filter", ["x:A1:B3", "y:D1:D2", "unique-only-flag:yes"], [["Name", "Score", "", "Name"], ["Ada", 4, "", "A"], ["Ada"]]);
  expect(output.cell(4, 0)?.value).toEqual({ kind: "string", value: "Ada" });
  expect(output.cell(5, 0)).toBeUndefined();
});
