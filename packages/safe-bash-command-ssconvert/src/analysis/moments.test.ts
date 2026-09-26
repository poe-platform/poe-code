import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Workbook, type Codec } from "../index.js";

it.each([
  ["anova", "data:A1:B4", 10, "=finv(0.050000000000000003,C11,C12)"],
  ["anova2", "data:A1:B4", 14, "=finv(0.050000000000000003,C15,C17)"],
] as const)("serializes %s alpha with released binary64 precision", async (tool, data, row, expression) => {
  const output = await analyze(tool, [data]);
  expect(output.cell(row, 6)?.formula).toBe(expression);
  const half = await analyze(tool, [data, "alpha:0.5"]);
  expect(half.cell(row, 6)?.formula).toBe(expression.replace("0.050000000000000003", "0.5"));
});

it("preserves released PCA absolute trace links and loading expression", async () => {
  const output = await analyze("principal-components", ["data:A1:B4"]);
  expect(output.cell(17, 1)?.formula).toBe("=B10/sum($B$10:$C$10)");
  expect(output.cell(17, 2)?.formula).toBe("=C10/sum($B$10:$C$10)");
  expect(output.cell(14, 1)?.formula).toBe("=mmult(mmult(sqrt(1/B8:C8)*munit(2),B11:C12),sqrt(B10:C10)*munit(2))");
  expect((output.cell(17, 1)?.value as { value: number }).value).toBeCloseTo(1, 12);
});

it("retains native regression residual formulas and absolute model links", async () => {
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4"]);
  expect(output.cell(20, 0)?.formula).toBe("=1");
  expect(output.cell(20, 2)?.formula).toBe("=sumproduct($B$17:$B$18,transpose(A21:B21))");
  expect(output.cell(20, 5)?.formula).toBe("=leverage($A$21:$B$24)");
  expect(output.cell(20, 6)?.formula).toBe("=E21/sqrt($D$13*(1-F21))");
  expect(output.cell(20, 7)?.formula).toBe("=E21/sqrt(($C$13-E21^2)/($B$13-1)*(1-F21))");
  expect(output.cell(20, 8)?.formula).toBe("=tdist(abs(H21),$B$13-1,2)");
  expect(output.cell(17, 1)?.formula).toContain("TRUE,TRUE");
});

export async function analyze(tool: string, properties: string[] = [], rows: (number | string)[][] = [[1,2],[2,4],[3,6],[4,8]]) {
  const volume = Volume.fromJSON({ "/input.fixture": "original", "/output.fixture": "keep" });
  const codec: Codec = { id: "fixture", description: "Original moments fixture", extensions: ["fixture"], probeContent: () => true,
    async read() { return { sheets: [{ id: "input", name: "Input", cells: rows.flatMap((values, row) => values.map((value, column) => ({ row, column,
      value: typeof value === "number" ? { kind: "number" as const, value } : { kind: "string" as const, value } }))) }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const diagnostics: string[] = [];
  const engine = createEngine({ codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10000, sheets: 10, operations: 1000000 },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; }, async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  const result = await runCommand([...[tool, ...properties].map(value => `--tool-test=${value}`), "/input.fixture", "/output.fixture"], engine,
    { signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(new TextDecoder().decode(bytes)); } } });
  await engine.dispose();
  expect(diagnostics).toEqual([]);
  expect(result.exitCode).toBe(0);
  const book = JSON.parse(volume.readFileSync("/output.fixture", "utf8") as string) as Workbook;
  return { book, sheet: book.sheets[1]!, cell: (row: number, column: number) => book.sheets[1]!.cells.find(cell => cell.row === row && cell.column === column) };
}

it.each(["correlation", "covariance"])("executes %s using repeated hidden arguments and linked formulas", async tool => {
  const output = await analyze(tool, ["data:A1:B4"]);
  expect(output.sheet.name).toBe(tool === "correlation" ? "Correlation (1)" : "Covariance (1)");
  expect(output.cell(1, 2)).toBeUndefined();
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: tool === "correlation" ? 1 : 2.5 });
  expect(output.cell(2, 1)?.formula).toBe(`=${tool === "correlation" ? "correl" : "covar"}(Input!$A$1:$A$4,Input!$B$1:$B$4)`);
});

it("writes descriptive moments and confidence bounds with native section spacing", async () => {
  const output = await analyze("descriptive-statistics", ["data:A1:A4", "formulas:no"]);
  expect(output.cell(1, 1)?.value).toEqual({ kind: "number", value: 2.5 });
  expect(output.cell(6, 1)?.value).toEqual({ kind: "number", value: 5 / 3 });
  expect(output.cell(13, 1)?.value).toEqual({ kind: "number", value: 4 });
  expect(output.cell(17, 0)?.value).toEqual({ kind: "string", value: "95% CI for the Mean from" });
  expect(output.cell(21, 1)?.value).toEqual({ kind: "number", value: 4 });
  expect(output.cell(25, 1)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.sheet.cells.every(cell => cell.formula === undefined)).toBe(true);
});

it("computes original single factor ANOVA with independently derived sums of squares", async () => {
  const output = await analyze("anova", ["data:A1:B4"]);
  expect(output.cell(10, 1)?.value).toEqual({ kind: "number", value: 12.5 });
  expect(output.cell(11, 1)?.value).toEqual({ kind: "number", value: 25 });
  expect(output.cell(12, 1)?.value).toEqual({ kind: "number", value: 37.5 });
});

it("executes detailed regression from explicit x/y ranges", async () => {
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4", "residual:no"]);
  expect(output.cell(17, 1)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(16, 1)?.value).toEqual({ kind: "number", value: 0 });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "number", value: 1 });
});

it("executes principal components using sample eigenvalues and population covariances", async () => {
  const output = await analyze("principal-components", ["data:A1:B4"]);
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: 1.25 });
  expect(output.cell(9, 1)?.value.kind).toBe("number");
  expect((output.cell(9, 1)?.value as { value: number }).value).toBeCloseTo(25 / 3, 12);
});

it("executes two factor ANOVA without replication", async () => {
  const output = await analyze("anova2", ["data:A1:B3"], [[1, 3], [2, 5], [4, 8]]);
  expect(output.cell(0, 0)?.value).toEqual({ kind: "string", value: "ANOVA: Two-Factor Without Replication" });
});

it("executes replicated two factor ANOVA with independent factorial sums of squares", async () => {
  const output = await analyze("anova2", ["data:$A$1:$B$4", "replication:2"], [[1,3],[2,4],[5,9],[6,10]]);
  expect(output.sheet.name).toBe("Two Factor ANOVA with Replication (1)");
  expect(output.cell(24, 1)?.value).toEqual({ kind: "number", value: 50 });
  expect(output.cell(25, 1)?.value).toEqual({ kind: "number", value: 18 });
  expect(output.cell(26, 1)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(27, 1)?.value).toEqual({ kind: "number", value: 2 });
});

it("preserves the two factor handler's relative input reference relocation", async () => {
  const output = await analyze("anova2", ["data:A1:B4"], [[1,2],[2,5],[3,5],[4,9]]);
  expect(output.cell(3, 1)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(3, 2)?.value).toEqual({ kind: "number", value: 0 });
  expect(output.cell(3, 3)?.value).toEqual({ kind: "error", value: "#DIV/0!" });
});

it("keeps principal components array ownership and native title/trace formatting", async () => {
  const output = await analyze("principal-components", ["data:A1:B4"]);
  expect(output.sheet.formulaGroups?.find(group => group.range.startRow === 9)?.range).toEqual({ startRow: 9, endRow: 11, startColumn: 1, endColumn: 2 });
  expect(output.sheet.formulaGroups?.find(group => group.range.startRow === 14)?.range).toEqual({ startRow: 14, endRow: 15, startColumn: 1, endColumn: 2 });
  expect(output.cell(0, 0)?.format).toBe('"Principal Components Analysis";[Red]"Principal Components Analysis is invalid."');
  expect(output.cell(17, 1)?.format).toBe("0.00%");
});

it("uses the released no-intercept Multiple R definition and marks excluded intercept statistics", async () => {
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4", "intercept:no", "residual:no"], [[1,2],[2,5],[3,5],[4,8]]);
  expect((output.cell(3, 1)?.value as { value: number }).value).toBeCloseTo(Math.sqrt(0.9), 12);
  expect(output.cell(16, 1)?.value).toEqual({ kind: "number", value: 0 });
  expect(output.cell(16, 2)?.value).toEqual({ kind: "error", value: "#N/A" });
});

it("keeps generic regression data distinct from explicit x/y and writes native reference errors", async () => {
  const output = await analyze("regression", ["data:A1:B4"]);
  expect(output.cell(0, 3)?.value).toEqual({ kind: "error", value: "#REF!" });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "error", value: "#REF!" });
  expect(output.cell(11, 1)?.value).toEqual({ kind: "number", value: 0 });
  expect(output.cell(16, 1)?.value).toEqual({ kind: "error", value: "#REF!" });
});

it("preserves relative dependent-reference relocation in simple regression", async () => {
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4", "multiple-regression:no"], [[1,2],[2,5],[3,5],[4,9]]);
  expect(output.cell(0, 3)?.value).toEqual({ kind: "string", value: "Column 5" });
  expect(output.cell(3, 1)?.value).toEqual({ kind: "error", value: "#VALUE!" });
});

it("calculates simple multiple-y models with a fixed explicit independent y range", async () => {
  const output = await analyze("regression", ["x:$B$1:$B$4", "y:$A$1:$A$4", "multiple-regression:no", "multiple-y:yes"], [[1,2],[2,5],[3,5],[4,9]]);
  expect(output.cell(0, 3)?.value).toEqual({ kind: "string", value: "Column 1" });
  expect((output.cell(3, 2)?.value as { value: number }).value).toBeCloseTo(2.1, 12);
});

it("writes detailed regression labels as formulas and preserves confidence formats and title merges", async () => {
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4", "residual:no"]);
  expect(output.cell(0, 3)?.formula).toBe('=concatenate("Column"," ",cell("col",Input!$B$1:$B$4))');
  expect(output.cell(17, 0)?.formula).toBe('=concatenate("Column"," ",cell("col",offset(Input!$A$1:$A$4,0,0)))');
  expect(output.cell(15, 5)?.format).toBe('"Lower" 0%');
  expect(output.cell(15, 6)?.format).toBe('"Upper" 0%');
  expect(output.sheet.merges).toEqual([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }, { startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 }]);
});

it("formats the two factor validity cell and merges the source-defined title rows", async () => {
  const output = await analyze("anova2", ["data:$A$1:$B$4"]);
  expect(output.cell(12, 0)?.format).toBe('"ANOVA";[Red]"Invalid ANOVA: Missing Observations"');
  expect(output.sheet.merges).toEqual([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 }, { startRow: 12, endRow: 12, startColumn: 0, endColumn: 6 }]);
  expect(output.cell(13, 1)?.style?.gnumeric).toBeDefined();
});

it("preserves released linked ANOVA degrees of freedom and PCA covariance argument ordering", async () => {
  const anova = await analyze("anova", ["data:A1:B4"]);
  expect(anova.cell(10, 1)?.formula).toBe("=B13-B12");
  expect(anova.cell(11, 1)?.formula).toBe("=sum(devsq(Input!$A$1:$A$4),devsq(Input!$B$1:$B$4))");
  const anova2 = await analyze("anova2", ["data:$A$1:$B$4"]);
  expect(anova2.cell(16, 2)?.formula).toBe("=C16*C15");
  expect(anova2.cell(17, 2)?.formula).toBe("=sum(C15:C17)");
  const pca = await analyze("principal-components", ["data:A1:B4"]);
  expect(pca.cell(3, 1)?.formula).toBe("=covar(Input!$A$1:$A$4,Input!$B$1:$B$4)");
  expect(pca.cell(0, 0)?.formula).toBe("=if(and(4=C6,4=B6),1,-1)");
});
