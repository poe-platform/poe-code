import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, renameWorkbookSheet, moveWorkbookSheet, recalculateWorkbook, type Workbook, type Codec, type CapabilityContext } from "../index.js";

export async function distribution(tool: string, properties: string[] = [], rows: (number | string)[][] = [[1,2],[2,4],[3,6],[4,8]]) {
  const volume = Volume.fromJSON({ "/input.fixture": "original" });
  const codec: Codec = { id: "fixture", description: "Original distribution fixture", extensions: ["fixture"], probeContent: () => true,
    async read() { return { sheets: [{ id: "input", name: "Input", cells: rows.flatMap((values, row) => values.map((value, column) => ({ row, column,
      value: typeof value === "number" ? { kind: "number" as const, value } : { kind: "string" as const, value } }))) }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const diagnostics: string[] = [];
  const engine = createEngine({ codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" }, random: { next: () => 0.25 },
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

it("implements released auto-expression placement and aggregate links", async () => {
  const output = await distribution("auto-expression", ["data:A1:B4", "function:SUM", "below:yes", "multiple:yes"]);
  expect(output.cell(0, 0)?.formula).toBe("=sum(Input!$A$1:$A$4)");
  expect(output.cell(0, 2)?.formula).toBe("=sum(A1:B1)");
  expect(output.cell(0, 2)?.value).toEqual({ kind: "number", value: 30 });
});

it("emits released Fourier array layout", async () => {
  const output = await distribution("fourier-analysis", ["data:A1:A4"]);
  expect(output.cell(0, 0)?.value).toEqual({ kind: "string", value: "Fourier Transform" });
  expect(output.cell(3, 0)?.formula).toBe("=fourier(Input!$A$1:$A$4,FALSE,TRUE)");
  expect(output.cell(3, 0)?.value).toEqual({ kind: "number", value: 2.5 });
});

it("samples reproducibly through the injected SDK random capability", async () => {
  const output = await distribution("sampling", ["data:A1:A4", "size:3", "number:2"]);
  expect(output.cell(1, 0)?.formula).toBe("=randdiscrete(Input!$A$1:$A$4)");
  expect(output.cell(1, 0)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(3, 1)?.value).toEqual({ kind: "number", value: 2 });
});

it("writes histogram bin links and array counts", async () => {
  const output = await distribution("histogram", ["data:A1:A4", "n:3"]);
  expect(output.cell(1, 1)?.formula).toBe("=min(Input!$A$1:$A$4)");
  expect(output.cell(2, 1)?.formula).toBe("=$B$2+1*(($B$4-$B$2)/2)");
  expect(output.cell(2, 2)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(3, 2)?.value).toEqual({ kind: "number", value: 2 });
});

it("writes simple exponential forecasts with input and alpha links", async () => {
  const output = await distribution("exponential-smoothing", ["data:A1:A4"]);
  expect(output.cell(3, 0)?.formula).toBe("=index(Input!$A$1:$A$4)");
  expect(output.cell(4, 0)?.formula).toBe("=$A$2*index(Input!$A$1:$A$4,1,1)+(1-$A$2)*A4");
  expect(output.cell(6, 0)?.value).toEqual({ kind: "number", value: 2.25 });
});

it("retains ranking ties and native percentile formulas", async () => {
  const output = await distribution("ranking", ["data:A1:A4", "av-ties:yes"], [[3],[1],[3],[2]]);
  expect(output.cell(2, 2)?.value).toEqual({ kind: "number", value: 1.5 });
  expect(output.cell(2, 3)?.formula).toBe("=percentrank(Input!$A$1:$A$4,B3,10)");
});

it("preserves normality array domain errors for short samples", async () => {
  const output = await distribution("normality-test", ["data:A1:B4"]);
  expect(output.cell(2, 1)?.formula).toBe("=adtest(Input!$A$1:$A$4)");
  expect(output.cell(2, 1)?.value).toEqual({ kind: "error", value: "#VALUE!" });
  expect(output.cell(1, 2)?.formula).toBe("=B2");
});

it("matches source frequency categories left blank in generated mode", async () => {
  const output = await distribution("frequency-tables", ["data:A1:A4", "n:2"]);
  expect(output.cell(2, 0)).toBeUndefined();
  expect(output.cell(2, 1)?.formula).toBe("=sum(if(Input!$A$1:$A$4=A3,1,0))");
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: 0 });
});

it.each([[1, 2], [2, 14 / 6], [4, 2.5]] as const)("supports moving average mode %s", async (mode, value) => {
  const output = await distribution("moving-average", ["data:A1:A4", "interval:3", `ma-type:${mode}`]);
  expect(output.cell(mode === 4 ? 4 : 3, 0)?.value).toEqual({ kind: "number", value });
});

it("computes moving standard errors in a separate linked column", async () => {
  const output = await distribution("moving-average", ["data:A1:A4", "interval:2", "std-error-flag:1"]);
  expect(output.cell(0, 1)?.value).toEqual({ kind: "string", value: "Standard Error" });
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: 0.5 });
  expect(output.cell(2, 1)?.formula).toBe("=sqrt(sumxmy2(offset(Input!$A$1:$A$4,1,0,1,1),A3)/1)");
});

it("initializes Holt level and trend from five observations", async () => {
  const output = await distribution("exponential-smoothing", ["data:A1:A6", "es-type:2"], [[2],[4],[6],[8],[10],[12]]);
  expect(output.cell(3, 0)?.formula).toBe("=index(linest(offset(Input!$A$1:$A$6,0,0,5,1)),1,2)");
  expect(output.cell(4, 0)?.value).toEqual({ kind: "number", value: 2 });
  expect(output.cell(4, 1)?.value).toEqual({ kind: "number", value: 2 });
});

it.each([3,4])("generates seasonal smoothing mode %s with linked initial estimates", async mode => {
  const output = await distribution("exponential-smoothing", ["data:A1:A8", `es-type:${mode}`, "s-period:2"], [[2],[5],[4],[7],[6],[9],[8],[11]]);
  expect(output.cell(2, 0)?.value).toEqual({ kind: "string", value: "Time" });
  expect(output.cell(2, 2)?.value).toEqual({ kind: "string", value: "Level" });
  expect(output.cell(5, 1)?.formula).toBe("=index(Input!$A$1:$A$8,A6,1)");
  expect(output.cell(4, 4)?.formula).toContain("average(if(mod(row(");
  expect(output.cell(5, 2)?.value.kind).toBe("number");
});

it("preserves the native last write for a single histogram bin", async () => {
  const output = await distribution("histogram", ["data:A1:A4"]);
  expect(output.cell(1, 1)?.formula).toBe("=max(Input!$A$1:$A$4)");
  expect(output.cell(1, 1)?.value).toEqual({ kind: "number", value: 4 });
  expect(output.sheet.cells.filter(cell => cell.row === 1 && cell.column === 1)).toHaveLength(1);
});

it.each([
  [0,1,"=sqrt(sumxmy2(offset(Input!$A$1:$A$8,1,0,1,1),A5)/1)"],
  [1,1,"=sqrt(sumxmy2(offset(Input!$A$1:$A$8,0,0,1,1),A4)/1)"],
  [2,2,"=sqrt(sumxmy2(offset(Input!$A$1:$A$8,0,0,1,1),A4+B4)/1)"],
] as const)("collapses the first smoothing standard-error window for mode %s", async (mode,column,formula) => {
  const output = await distribution("exponential-smoothing", ["data:A1:A8", `es-type:${mode}`, "std-error-flag:1"], [[2],[5],[4],[7],[6],[9],[8],[11]]);
  expect(output.cell(4,column)?.formula).toBe(formula);
});

it.each([
  ["moving-average",1,0,10], ["exponential-smoothing",3,0,10], ["histogram",1,1,2],
  ["frequency-tables",2,1,1], ["fourier-analysis",3,0,45/8], ["sampling",1,0,10],
  ["ranking",2,1,10], ["normality-test",2,1,undefined], ["auto-expression",0,0,45],
] as const)("keeps %s links live after input edits, sheet rename and reorder", async (tool,row,column,expected) => {
  const properties = ["data:A1:A8", "n:3"];
  if (tool === "auto-expression") properties.push("function:SUM");
  if (tool === "sampling") properties.push("periodic:yes", "period:1", "number:1", "size:3");
  const output = await distribution(tool, properties, [[1],[2],[3],[4],[5],[6],[7],[8]]);
  const context: CapabilityContext = { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    random: { next: () => 0.25 }, limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10000, sheets: 10, operations: 1000000 }, own() {} };
  const edited = { ...output.book, sheets: output.book.sheets.map((sheet,i) => i ? sheet : { ...sheet, cells: sheet.cells.map(cell =>
    cell.row === 0 && cell.column === 0 ? { ...cell, value: { kind: "number" as const, value: tool === "frequency-tables" ? 0 : 10 } } : cell) }) };
  const renamed = renameWorkbookSheet(edited,"input","Edited Input",context);
  const moved = moveWorkbookSheet(renamed,"input",1,context);
  const result = recalculateWorkbook(moved,context,true);
  const generated = result.sheets.find(sheet => sheet.id === output.sheet.id)!;
  expect(generated.cells.some(cell => cell.formula?.includes("'Edited Input'!"))).toBe(true);
  expect(generated.cells.some(cell => cell.formula?.includes("Input!"))).toBe(false);
  const value = generated.cells.find(cell => cell.row === row && cell.column === column)!.value;
  if (expected === undefined) {
    expect(value.kind).toBe("number");
    expect(value).not.toEqual(output.cell(row,column)?.value);
  } else expect(value).toEqual({ kind: "number", value: expected });
  expect(output.book.sheets[0]!.name).toBe("Input");
  expect(output.book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 1 });
});
