import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Workbook, type Codec } from "../index.js";

async function invoke(tool: string, properties: string[] = [], rows: (number | string)[][] = [[1,2],[2,4],[3,6],[4,8]], settings: { cells?: number; signal?: AbortSignal } = {}) {
  const volume = Volume.fromJSON({ "/input.fixture": "original" });
  const codec: Codec = { id: "fixture", description: "Independent original fixture", extensions: ["fixture"], probeContent: () => true,
    async read() { return { sheets: [{ id: "input", name: "Input", cells: rows.flatMap((values, row) => values.map((value, column) => ({ row, column,
      value: typeof value === "number" ? { kind: "number" as const, value } : { kind: "string" as const, value } }))) }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const diagnostics: string[] = [];
  const engine = createEngine({ codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" }, random: { next: () => 0 },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: settings.cells ?? 10000, sheets: 10, operations: 1000000 },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; }, async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  try {
    const result = await runCommand([...[tool, ...properties].map(value => `--tool-test=${value}`), "/input.fixture", "/output.fixture"], engine,
      { signal: settings.signal ?? new AbortController().signal, stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(new TextDecoder().decode(bytes)); } } });
    const book = volume.existsSync("/output.fixture") ? JSON.parse(volume.readFileSync("/output.fixture", "utf8") as string) as Workbook : undefined;
    return { result, diagnostics, book, cell: (row: number, column: number) => book?.sheets[1]?.cells.find(cell => cell.row === row && cell.column === column) };
  } finally { await engine.dispose(); }
}

async function distribution(tool: string, properties: string[], rows?: (number | string)[][]) {
  const output = await invoke(tool, properties, rows);
  expect(output.result.exitCode).toBe(0);
  expect(output.diagnostics).toEqual([]);
  return output;
}

it("keeps area sampling labels in the input range and skips the label by offset", async () => {
  const output = await distribution("sampling", ["data:A1:B3", "group-by:area", "labels:yes", "periodic:yes", "period:1", "size:3", "number:2"], [["label",10],[20,30],[40,50]]);
  expect(output.cell(0, 0)?.formula).toBe("=index(Input!$A$1:$B$3)");
  expect(output.cell(1, 0)?.formula).toBe("=index(Input!$A$1:$B$3,2,1)");
  expect(output.cell(1, 1)?.formula).toBe("=index(Input!$A$1:$B$3,1,2)");
  expect(output.cell(1, 0)?.value).toEqual({ kind: "number", value: 20 });
  expect(output.cell(1, 1)?.value).toEqual({ kind: "number", value: 10 });
});

it("retains the first area cell in random samples even when it supplies the label", async () => {
  const output = await distribution("sampling", ["data:A1:B3", "group-by:area", "labels:yes", "size:1", "number:1"], [[99,10],[20,30],[40,50]]);
  expect(output.cell(1, 0)?.formula).toBe("=randdiscrete(Input!$A$1:$B$3)");
  expect(output.cell(1, 0)?.value).toEqual({ kind: "number", value: 99 });
});

it("alternates periodic sampling traversal for all replicated output columns", async () => {
  const output = await distribution("sampling", ["data:A1:B3", "group-by:area", "periodic:yes", "period:2", "size:3", "number:4"]);
  expect(output.cell(1, 0)?.formula).toBe("=index(Input!$A$1:$B$3,2,1)");
  expect(output.cell(1, 1)?.formula).toBe("=index(Input!$A$1:$B$3,1,2)");
  expect(output.cell(1, 2)?.formula).toBe(output.cell(1, 0)?.formula);
  expect(output.cell(1, 3)?.formula).toBe(output.cell(1, 1)?.formula);
});

it("wraps periodic sampling offsets with native guint arithmetic", async () => {
  const output = await distribution("sampling", ["data:A1:A3", "periodic:yes", "offset:4294967295", "period:2", "size:2", "number:1"], [[11],[22],[33]]);
  expect(output.cell(2, 0)?.formula).toBe("=index(Input!$A$1:$A$3,1,1)");
  expect(output.cell(2, 0)?.value).toEqual({ kind: "number", value: 11 });
});

it("converts periodic sampling coordinates to signed native gint", async () => {
  const output = await distribution("sampling", ["data:A1:A3", "periodic:yes", "offset:2147483648", "period:1", "size:1", "number:1", "row-major:yes"], [[11],[22],[33]]);
  expect(output.cell(1, 0)?.formula).toBe("=index(Input!$A$1:$A$3,-2147483648,1)");
  expect(output.cell(1, 0)?.value).toEqual({ kind: "error", value: "#REF!" });
});

it("wraps the zero periodic offset predecessor before coordinate division", async () => {
  const output = await distribution("sampling", ["data:A1:A3", "periodic:yes", "period:0", "size:1", "number:1"], [[11],[22],[33]]);
  expect(output.cell(1, 0)?.formula).toBe("=index(Input!$A$1:$A$3,1,1431655766)");
  expect(output.cell(1, 0)?.value).toEqual({ kind: "error", value: "#REF!" });
});

it.each([
  ["no", "no", 1, "=index(Input!$A$1:$A$3,3,1431655765)"],
  ["yes", "no", 1, "=index(Input!$A$1:$A$3,1,1431655766)"],
  ["no", "yes", 2147483648, "=index(Input!$A$1:$A$3,2147483646,1)"],
  ["yes", "yes", 4294967295, "=index(Input!$A$1:$A$3,-2,1)"],
])("matches independently measured periodic overflow with labels %s and row-major %s", async (labels, major, offset, expected) => {
  const output = await distribution("sampling", ["data:A1:A3", "group-by:area", "periodic:yes", "number:2", "size:3", "period:4294967295", `offset:${offset}`, `labels:${labels}`, `row-major:${major}`], [[11],[22],[33]]);
  expect(output.cell(3, 0)?.formula).toBe(expected);
});

it("uses row labels and excludes them from moving windows", async () => {
  const output = await distribution("moving-average", ["data:A1:D2", "group-by:row", "labels:yes", "interval:2"], [["first",2,4,6],["second",10,20,30]]);
  expect(output.cell(0, 1)?.value).toEqual({ kind: "string", value: "second" });
  expect(output.cell(2, 0)?.formula).toBe("=average(offset(Input!$B$1:$D$1,0,0,1,2))");
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: 15 });
});

it("keeps ranking tie positions, numeric ordering, arrays and percentile styles", async () => {
  const output = await distribution("ranking", ["data:A1:A4", "av-ties:yes"], [[3],[1],[3],[2]]);
  expect(output.cell(2, 0)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(3, 0)?.value).toEqual({ kind: "number", value: 1 });
  expect(output.cell(4, 0)?.value).toEqual({ kind: "number", value: 4 });
  expect(output.cell(3, 2)?.value).toEqual({ kind: "number", value: 1.5 });
  expect(output.cell(2, 3)?.format).toBe("0%");
  expect(output.book?.sheets[1]?.formulaGroups).toHaveLength(2);
});

it.each(["moving-average", "sampling", "ranking", "fourier-analysis", "normality-test", "frequency-tables", "histogram", "exponential-smoothing", "auto-expression"])("bounds %s before exporting output", async tool => {
  const output = await invoke(tool, ["data:A1:B4", "size:100", "number:2", "n:100", "function:SUM"], undefined, { cells: 9 });
  expect(output.result.exitCode).toBe(1);
  expect(output.book).toBeUndefined();
  expect(output.diagnostics.join("")).toContain("limit");
});

it.each(["moving-average", "sampling", "ranking", "fourier-analysis", "normality-test", "frequency-tables", "histogram", "exponential-smoothing", "auto-expression"])("propagates cancellation for %s through the actual command", async tool => {
  const controller = new AbortController(), reason = { independent: "cancel" };
  controller.abort(reason);
  await expect(invoke(tool, ["data:A1:B4"], undefined, { signal: controller.signal })).rejects.toBe(reason);
});

it.each(["ranking", "fourier-analysis", "normality-test", "frequency-tables", "histogram", "exponential-smoothing", "moving-average"])("removes formulas and array metadata in %s values-only mode", async tool => {
  const output = await distribution(tool, ["data:A1:A4", "formulas:no", "n:3"]);
  const sheet = output.book!.sheets[1]!;
  expect(sheet.cells.some(cell => cell.formula !== undefined || cell.formulaGroup !== undefined)).toBe(false);
  expect(sheet.formulaGroups ?? []).toEqual([]);
  expect(sheet.cells.some(cell => cell.value.kind === "number")).toBe(true);
});

it("keeps nonnumeric ranking entries as array domain errors", async () => {
  const output = await distribution("ranking", ["data:A1:A4"], [[3],["ignored"],[1],[2]]);
  expect(output.cell(2, 1)?.value).toEqual({ kind: "number", value: 3 });
  expect(output.cell(5, 1)?.value).toEqual({ kind: "error", value: "#NUM!" });
});

it("retains labels in auto-expression aggregates because its source handler does not remove them", async () => {
  const output = await distribution("auto-expression", ["data:A1:B3", "labels:yes", "function:SUM", "below:yes", "multiple:yes"], [[100,200],[1,2],[3,4]]);
  expect(output.cell(0, 0)?.formula).toBe("=sum(Input!$A$1:$A$3)");
  expect(output.cell(0, 0)?.value).toEqual({ kind: "number", value: 104 });
  expect(output.cell(0, 2)?.value).toEqual({ kind: "number", value: 310 });
});
