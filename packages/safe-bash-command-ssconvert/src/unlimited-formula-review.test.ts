import { expect, it } from "vitest";
import { defaultSsconvertLimits, recalculateWorkbook } from "./index.js";
import { parseExpression } from "./formulas/parser.js";
import { snapshotRecords } from "./workbook/model.js";
import type { Workbook } from "./workbook.js";

const context = { own() {}, signal: new AbortController().signal, limits: defaultSsconvertLimits, environment: { cwd: "/", env: {}, locale: "C", timezone: "UTC" } };
it("calculates a dependency chain beyond the former 128-cell cap", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: Array.from({ length: 150 }, (_, row) => ({
    row, column: 0, value: { kind: "number", value: 1 }, ...(row < 149 ? { formula: `=A${row + 2}+1`, formulaDirty: true } : {})
  })) }] };
  expect((await recalculateWorkbook(book, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 150 });
});
it("calculates a left-associative formula beyond the former AST height cap", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0,
    value: { kind: "number", value: 0 }, formula: "=" + Array(150).fill("1").join("+"), formulaDirty: true }] }] };
  expect((await recalculateWorkbook(book, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 150 });
});
it("does not invent parser length or node limits when omitted", () => {
  const source = '="' + "x".repeat(1_048_577) + '"';
  expect(parseExpression(source, { position: { sheet: "s", row: 0, column: 0 } }).ok).toBe(true);
  expect(parseExpression("=SUM(" + Array(65_537).fill("1").join(",") + ")", { position: { sheet: "s", row: 0, column: 0 } }).ok).toBe(true);
});
it("retains explicit parser budgets", () => {
  expect(() => parseExpression("=1+2", { position: { sheet: "s", row: 0, column: 0 }, maximumNodes: 2 })).toThrow("node limit");
  expect(() => parseExpression("=123", { position: { sheet: "s", row: 0, column: 0 }, maximumLength: 3 })).toThrow("length limit");
});
it("owns records deeper than 128 with unlimited budgets", () => {
  let record: unknown = "leaf";
  for (let i = 0; i < 150; i++) record = { child: record };
  expect(snapshotRecords(record, defaultSsconvertLimits)).toEqual(record);
});
it("lets a timer abort a large public recalculation with a frozen clock", async () => {
  const controller = new AbortController();
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: Array.from({ length: 20_000 }, (_, row) => ({
    row, column: 0, value: { kind: "number", value: 0 }, formula: "=1+1", formulaDirty: true
  })) }] };
  const timer = setTimeout(() => controller.abort(new Error("timer cancellation")), 0);
  try {
    await expect(Promise.resolve().then(() => recalculateWorkbook(book, { ...context, signal: controller.signal, clock: { now: () => 0 } }))).rejects.toThrow("timer cancellation");
  } finally { clearTimeout(timer); }
});
it("lets a timer abort solver work with a frozen clock", async () => {
  const { runSolver } = await import("./index.js");
  const { solverRecord, constraintRecord } = await import("./codecs/mps.js");
  const controller = new AbortController();
  const book: Workbook = { activeSheet: "s", sheets: [{ id: "s", name: "Sheet", cells: [
    ...Array.from({ length: 60 }, (_, row) => ({ row, column: 0, value: { kind: "number" as const, value: 0 } })),
    ...Array.from({ length: 60 }, (_, row) => ({ row, column: 2, value: { kind: "number" as const, value: 1 } })),
    { row: 0, column: 1, formula: "=SUM(A1:A60)", value: { kind: "number", value: 0 } }
  ], unsupportedRecords: [{ source: "gnumeric", kind: "Solver", disposition: "retained", data: solverRecord({
    Target: "B1", Inputs: "A1:A60", ProblemType: "1"
  }, [constraintRecord(1, "A1:A60", "C1:C60")]) }] }] };
  const timer = setTimeout(() => controller.abort(new Error("solver cancellation")), 0);
  try {
    await expect(runSolver(book, { ...context, signal: controller.signal, clock: { now: () => 0 } }).then(() => undefined)).rejects.toThrow("solver cancellation");
  } finally { clearTimeout(timer); }
});
it("admits deep syntax and named-expression ASTs with default budgets", async () => {
  const source = "=" + "(".repeat(150) + "1" + ")".repeat(150);
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0,
    value: { kind: "number", value: 0 }, formula: "=long", formulaDirty: true }] }], names: [{ name: "long", expression: source }] };
  expect((await recalculateWorkbook(book, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 1 });
});
it("admits PERL_SED groups deeper than the former 64-group cap", async () => {
  const { perlSampleFunctions } = await import("./index.js");
  const pattern = "(?:".repeat(70) + "x" + ")".repeat(70);
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0,
    value: { kind: "blank" }, formula: `=PERL_SED("x","${pattern}","y")`, formulaDirty: true }] }] };
  expect((await recalculateWorkbook(book, { ...context, runtimeFunctions: perlSampleFunctions })).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "y" });
});
it("does not invent CLI argument or output budgets when optional limits are omitted", async () => {
  const { createEngine, runCommand } = await import("./index.js");
  const engine = createEngine({ codecs: [], environment: context.environment });
  const limits = { ...engine.limits };
  delete limits.argumentBytes;
  delete limits.commandOutputBytes;
  let output = "";
  try {
    await runCommand(["--" + "x".repeat(1_048_577)], { ...engine, limits }, {
      signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } }
    });
    expect(output).not.toContain("limit exceeded");
    expect(output.length).toBeGreaterThan(1_048_576);
  } finally { await engine.dispose(); }
});
