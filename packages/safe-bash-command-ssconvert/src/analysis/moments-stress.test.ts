import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Workbook, type Codec } from "../index.js";

async function analyze(tool: string, properties: string[] = [], rows: (number | string)[][] = [[1,2],[2,4],[3,6],[4,8]]) {
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

it("numbers single-factor ANOVA groups from one, including row grouping", async () => {
  const columns = await analyze("anova", ["data:A1:B4"]);
  expect(columns.cell(4, 0)?.value).toEqual({ kind: "string", value: "Column 1" });
  expect(columns.cell(5, 0)?.value).toEqual({ kind: "string", value: "Column 2" });
  const rows = await analyze("anova", ["data:A1:D2", "group-by:row"], [[1,2,3,4], [2,4,6,8]]);
  expect(rows.cell(4, 0)?.value).toEqual({ kind: "string", value: "Row 1" });
  expect(rows.cell(5, 0)?.value).toEqual({ kind: "string", value: "Row 2" });
});

it("uses row positions for simple row-grouped regression labels", async () => {
  const output = await analyze("regression", ["x:A1:D1", "y:A2:D2", "group-by:row", "multiple-regression:no"], [[1,2,3,4], [2,5,5,8]]);
  expect(output.cell(0, 3)?.value).toEqual({ kind: "string", value: "Row 2" });
  expect(output.cell(3, 0)?.value).toEqual({ kind: "string", value: "Row 1" });
});

it("computes nonperfect regression, residuals, and no-intercept coefficients independently", async () => {
  const rows = [[1,2], [2,5], [3,5], [4,8]];
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4"], rows);
  expect((output.cell(17, 1)?.value as { value: number }).value).toBeCloseTo(1.8, 12);
  expect((output.cell(16, 1)?.value as { value: number }).value).toBeCloseTo(0.5, 12);
  expect((output.cell(4, 1)?.value as { value: number }).value).toBeCloseTo(0.9, 12);
  expect((output.cell(12, 2)?.value as { value: number }).value).toBeCloseTo(1.8, 12);
  expect((output.cell(20, 4)?.value as { value: number }).value).toBeCloseTo(-0.3, 12);
  const noIntercept = await analyze("regression", ["x:A1:A4", "y:B1:B4", "intercept:no", "residual:no"], rows);
  expect((noIntercept.cell(17, 1)?.value as { value: number }).value).toBeCloseTo(59 / 30, 12);
  expect(noIntercept.cell(16, 1)?.value).toEqual({ kind: "number", value: 0 });
  expect((noIntercept.cell(12, 2)?.value as { value: number }).value).toBeCloseTo(59 / 30, 12);
});

it("links row labels and strips them from correlation data with pairwise missing values", async () => {
  const output = await analyze("correlation", ["data:A1:E2", "group-by:row", "labels:yes"], [["a",1,2,"missing",4], ["b",2,"missing",6,8]]);
  expect(output.cell(0, 1)?.formula).toBe("=Input!$A$1");
  expect(output.cell(0, 1)?.value).toEqual({ kind: "string", value: "a" });
  expect(output.cell(2, 1)?.formula).toBe("=correl(Input!$B$1:$E$1,Input!$B$2:$E$2)");
  expect((output.cell(2, 1)?.value as { value: number }).value).toBeCloseTo(1, 12);
});

it("emits only selected descriptive sections with custom confidence and ranks", async () => {
  const output = await analyze("descriptive-statistics", ["data:A1:A4", "do-summary-statistics:no", "confidence-level:0.9", "k-largest:2", "k-smallest:3", "formulas:no"]);
  expect(output.cell(1, 0)?.value).toEqual({ kind: "string", value: "90% CI for the Mean from" });
  expect(output.cell(5, 0)?.value).toEqual({ kind: "string", value: "Largest (2)" });
  expect(output.cell(5, 1)?.value).toEqual({ kind: "number", value: 3 });
  expect(output.cell(9, 1)?.value).toEqual({ kind: "number", value: 3 });
});

it("computes distinct sample PCA eigenvalues and trace percentages", async () => {
  const output = await analyze("principal-components", ["data:A1:B4"], [[1,1], [2,-1], [-1,2], [-2,-2]]);
  // Sample covariance is [[10/3, 1/3], [1/3, 10/3]].
  expect((output.cell(9, 1)?.value as { value: number }).value).toBeCloseTo(11 / 3, 12);
  expect((output.cell(9, 2)?.value as { value: number }).value).toBeCloseTo(3, 12);
  expect((output.cell(17, 1)?.value as { value: number }).value).toBeCloseTo(0.55, 12);
});

it("emits source-defined residual leverage and studentization columns", async () => {
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4"], [[1,2], [2,5], [3,5], [4,8]]);
  expect(output.cell(19, 5)?.value).toEqual({ kind: "string", value: "Leverages" });
  expect(output.cell(19, 6)?.value).toEqual({ kind: "string", value: "Internally studentized" });
  expect(output.cell(19, 7)?.value).toEqual({ kind: "string", value: "Externally studentized" });
  expect(output.cell(19, 8)?.value).toEqual({ kind: "string", value: "p-Value" });
  expect((output.cell(20, 5)?.value as { value: number }).value).toBeCloseTo(0.7, 12);
  expect((output.cell(20, 6)?.value as { value: number }).value).toBeCloseTo(-1 / Math.sqrt(3), 12);
  // Released source uses (SSE - residual^2)/(df-1), without dividing by (1-h).
  expect((output.cell(20, 7)?.value as { value: number }).value).toBeCloseTo(-0.3 / Math.sqrt(1.71 * 0.3), 12);
  expect(output.cell(20, 6)?.format).toBe("0.0000");
  expect(output.sheet.formulaGroups?.find(group => group.range.startColumn === 5)?.range).toEqual({ startRow: 20, endRow: 23, startColumn: 5, endColumn: 5 });
});

it("retains native linked residual design and response array regions", async () => {
  const output = await analyze("regression", ["x:A1:A4", "y:B1:B4"], [[1,2], [2,5], [3,5], [4,8]]);
  expect(output.sheet.formulaGroups?.find(group => group.range.startRow === 19)?.range).toEqual({ startRow: 19, endRow: 19, startColumn: 1, endColumn: 1 });
  expect(output.cell(19, 1)?.formula).toBe("=transpose(A18)");
  expect(output.sheet.formulaGroups?.find(group => group.range.startRow === 20 && group.range.startColumn === 1)?.range).toEqual({ startRow: 20, endRow: 23, startColumn: 1, endColumn: 1 });
  expect(output.cell(20, 1)?.formula).toBe("=Input!$A$1:$A$4");
  expect(output.cell(20, 3)?.formula).toBe("=Input!$B$1:$B$4");
});

it("computes covariance from paired numeric positions with labels and missing cells", async () => {
  const output = await analyze("covariance", ["data:A1:B5", "labels:yes"], [["x","y"], [1,2], [2,"missing"], ["missing",6], [4,8]]);
  expect((output.cell(2, 1)?.value as { value: number }).value).toBeCloseTo(4.5, 12);
  expect(output.cell(2, 1)?.formula).toBe("=covar(Input!$A$2:$A$5,Input!$B$2:$B$5)");
});

it("holds out two labeled predictors with independent orthogonal residual calculations", async () => {
  const output = await analyze("regression", ["x:$A$1:$B$6", "y:$C$1:$C$6", "labels:yes"],
    [["linear", "quadratic", "response"], [-2,2,-1], [-1,-1,-0.5], [0,-2,4], [1,-1,7.5], [2,2,5]]);
  // The columns, constant, and residual (1,-2,0,2,-1) are mutually orthogonal.
  expect((output.cell(16, 1)?.value as { value: number }).value).toBeCloseTo(3, 12);
  expect((output.cell(17, 1)?.value as { value: number }).value).toBeCloseTo(2, 12);
  expect((output.cell(18, 1)?.value as { value: number }).value).toBeCloseTo(-0.5, 12);
  expect((output.cell(12, 2)?.value as { value: number }).value).toBeCloseTo(10, 12);
  expect(output.cell(12, 1)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(20, 2)?.value).toEqual({ kind: "string", value: "quadratic" });
  expect((output.cell(21, 3)?.value as { value: number }).value).toBeCloseTo(-2, 12);
  expect((output.cell(21, 5)?.value as { value: number }).value).toBeCloseTo(1, 12);
  expect(output.sheet.formulaGroups?.find(group => group.range.startRow === 21 && group.range.startColumn === 1)?.range)
    .toEqual({ startRow: 21, endRow: 25, startColumn: 1, endColumn: 2 });
});

it("holds out simple multiple-y ordering with an absolute shared predictor", async () => {
  const output = await analyze("regression", ["x:$B$1:$C$4", "y:$A$1:$A$4", "multiple-regression:no", "multiple-y:yes"],
    [[1,5,1], [2,7,-2], [3,9,-5], [4,11,-8]]);
  expect(output.cell(0, 2)?.value).toEqual({ kind: "string", value: "Independent Variable" });
  expect(output.cell(3, 0)?.value).toEqual({ kind: "string", value: "Column 2" });
  expect(output.cell(4, 0)?.value).toEqual({ kind: "string", value: "Column 3" });
  expect((output.cell(3, 2)?.value as { value: number }).value).toBeCloseTo(2, 12);
  expect((output.cell(3, 3)?.value as { value: number }).value).toBeCloseTo(3, 12);
  expect((output.cell(4, 2)?.value as { value: number }).value).toBeCloseTo(-3, 12);
  expect((output.cell(4, 3)?.value as { value: number }).value).toBeCloseTo(4, 12);
});

it("holds out labeled area PCA using one flattened variable and native arrays", async () => {
  const output = await analyze("principal-components", ["data:$A$1:$B$3", "group-by:area", "labels:yes"],
    [["area", "ignored header"], [1,2], [3,4]]);
  expect(output.cell(1, 1)?.value).toEqual({ kind: "string", value: "area" });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "number", value: 4 });
  expect((output.cell(8, 1)?.value as { value: number }).value).toBeCloseTo(5 / 3, 12);
  expect(output.cell(14, 1)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.sheet.formulaGroups?.find(group => group.range.startRow === 8)?.range)
    .toEqual({ startRow: 8, endRow: 9, startColumn: 1, endColumn: 1 });
});

it("retains no-intercept residual numerics through native SUMPRODUCT links", async () => {
  const output = await analyze("regression", ["x:$A$1:$A$4", "y:$B$1:$B$4", "intercept:no"], [[1,2], [2,5], [3,5], [4,8]]);
  expect(output.cell(20, 2)?.formula).toBe("=sumproduct($B$17:$B$18,transpose(A21:B21))");
  expect((output.cell(20, 2)?.value as { value: number }).value).toBeCloseTo(59 / 30, 12);
  expect((output.cell(20, 4)?.value as { value: number }).value).toBeCloseTo(1 / 30, 12);
  expect((output.cell(20, 5)?.value as { value: number }).value).toBeCloseTo(1 / 30, 12);
  expect(output.cell(17, 1)?.formula).toContain("FALSE,TRUE");
});

it("holds out three distinct diagonal PCA axes and absolute trace denominators", async () => {
  const rows = [[3,0,0], [-3,0,0], [0,2,0], [0,-2,0], [0,0,1], [0,0,-1]];
  const output = await analyze("principal-components", ["data:$A$1:$C$6"], rows);
  // Centered orthogonal axes have sample eigenvalues (18,8,2)/5.
  for (const [column, eigenvalue, proportion] of [[1,18 / 5,9 / 14], [2,8 / 5,4 / 14], [3,2 / 5,1 / 14]]) {
    expect((output.cell(10, column!)?.value as { value: number }).value).toBeCloseTo(eigenvalue!, 12);
    expect((output.cell(20, column!)?.value as { value: number }).value).toBeCloseTo(proportion!, 12);
    expect(output.cell(20, column!)?.formula).toBe(`=${["", "B", "C", "D"][column!]}11/sum($B$11:$D$11)`);
    expect(output.cell(20, column!)?.format).toBe("0.00%");
  }
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    // Eigenvector signs are arbitrary; squared standardized loadings are fixed.
    const value = (output.cell(16 + row, 1 + column)?.value as { value: number }).value;
    expect(value * value).toBeCloseTo(row === column ? 1 : 0, 12);
  }
  expect(output.cell(16, 1)?.formula).toBe("=mmult(mmult(sqrt(1/B9:D9)*munit(3),B12:D14),sqrt(B11:D11)*munit(3))");
  const values = await analyze("principal-components", ["data:$A$1:$C$6", "formulas:no"], rows);
  expect(values.sheet.formulaGroups).toEqual([]);
  expect(values.sheet.cells.every(cell => cell.formula === undefined && cell.formulaGroup === undefined)).toBe(true);
  expect((values.cell(20, 3)?.value as { value: number }).value).toBeCloseTo(1 / 14, 12);
});

it.each([
  ["0", "0"], ["1", "1"], ["0.0001", "0.0001"],
  ["0.00001", "1.0000000000000001e-05"], ["0.0000001", "9.9999999999999995e-08"],
])("holds out alpha %s serialization across both ANOVA2 branches", async (alpha, serialized) => {
  const rows = [[1,3], [2,4], [5,9], [6,10]];
  const cases = [
    { tool: "anova", properties: [], cells: [[10,1,6]] },
    { tool: "anova2", properties: [], cells: [[14,3,3], [15,1,3]] },
    { tool: "anova2", properties: ["replication:2"], cells: [[24,1,4], [25,1,4], [26,1,4]] },
  ];
  for (const specification of cases) {
    const output = await analyze(specification.tool, ["data:$A$1:$B$4", ...specification.properties, `alpha:${alpha}`], rows);
    for (const [row, numeratorDf, denominatorDf] of specification.cells) {
      const critical = output.cell(row!, 6);
      expect(critical?.formula).toBe(`=finv(${serialized},C${row! + 1},C${specification.tool === "anova" ? 12 : specification.properties.length ? 28 : 17})`);
      expect(output.cell(row!, 2)?.value).toEqual({ kind: "number", value: numeratorDf });
      const denominator = specification.tool === "anova" ? 11 : specification.properties.length ? 27 : 16;
      expect(output.cell(denominator, 2)?.value).toEqual({ kind: "number", value: denominatorDf });
      if (alpha === "0") expect(critical?.value).toEqual({ kind: "error", value: "#NUM!" });
    }
  }
});
