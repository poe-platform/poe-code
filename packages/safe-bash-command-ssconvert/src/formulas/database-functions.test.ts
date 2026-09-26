import { expect, it } from "vitest";
import * as publicApi from "../index.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";

// Authenticated plugins/gda/plugin-gda.c: four string arguments, read-only
// connections, SELECT * FROM table, blank empty recordsets and row-limit error.
const context: CapabilityContext = {
  signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 4, operations: 100, workbookWork: 1000000 }
};
function calculate(formula: string, query: publicApi.DatabaseQuery, rows = 128) {
  const book: Workbook = { sheets: [{ id: "s", name: "S", size: { rows, columns: 128 }, cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] };
  return recalculateWorkbook(book, { ...context, runtimeFunctions: publicApi.createDatabaseFunctions(query) }).sheets[0]!.cells[0]!.value;
}
it("enables EXECSQL only through an explicit cooperative read-only query capability", () => {
  let calls = 0;
  expect(calculate('=SUM(EXECSQL("owned","user","pass","SELECT value FROM t"))', (request, host) => {
    calls++; expect(request).toEqual({ dsn: "owned", username: "user", password: "pass", sql: "SELECT value FROM t", readOnly: true });
    expect(Object.isFrozen(request)).toBe(true); expect(host.context.signal).toBe(context.signal); host.tick();
    return { kind: "recordset", rows: [[{ kind: "number", value: 2 }], [{ kind: "number", value: 7 }]] };
  })).toEqual({ kind: "number", value: 9 });
  expect(calls).toBe(1);
});
it("routes READDBTABLE through the native SELECT construction without rewriting SQL", () => {
  expect(calculate('=READDBTABLE("owned","","","schema.table")', request => {
    expect(request.sql).toBe("SELECT * FROM schema.table");
    return { kind: "recordset", rows: [[{ kind: "boolean", value: true }, { kind: "string", value: "kept" }]] };
  })).toEqual({ kind: "boolean", value: true });
});
it("retains native blank results for absent or zero-row recordsets", () => {
  for (const result of [{ kind: "empty" as const }, { kind: "recordset" as const, rows: [] }])
    expect(calculate('=EXECSQL("owned","","","SELECT 1")', () => result)).toEqual({ kind: "blank" });
});
it("returns source-defined connection and query errors without swallowing host exceptions", () => {
  expect(calculate('=EXECSQL("owned","","","SELECT 1")', () => ({ kind: "connection-error" })))
    .toEqual({ kind: "error", value: "Error: could not open connection to owned" });
  expect(calculate('=EXECSQL("owned","","","SELECT 1; SELECT 2")', () => ({ kind: "query-error", message: "More than one statement in SQL string" })))
    .toEqual({ kind: "error", value: "More than one statement in SQL string" });
  const error = new Error("host transport failed");
  expect(() => calculate('=EXECSQL("owned","","","SELECT 1")', () => { throw error; })).toThrow(error);
});
it("refuses rowcounts at the source sheet maximum while retaining generic cell budgets", () => {
  const query: publicApi.DatabaseQuery = () => ({ kind: "recordset", rows: Array.from({ length: 128 }, (_, index) => [{ kind: "number", value: index + 1 }]) });
  expect(calculate('=EXECSQL("owned","","","SELECT 1")', query, 128))
    .toEqual({ kind: "error", value: "Too much data returned" });
  expect(calculate('=SUM(EXECSQL("owned","","","SELECT 1"))', query, 256))
    .toEqual({ kind: "number", value: 8256 });
});
it("applies C-string truncation and evaluator argument admission before host access", () => {
  let calls = 0;
  const query: publicApi.DatabaseQuery = request => {
    calls++; expect(request).toEqual({ dsn: "owned", username: "1", password: "", sql: "SELECT 1", readOnly: true });
    return { kind: "empty" };
  };
  expect(calculate('=EXECSQL("owned\0ignored",1,"","SELECT 1\0; ignored")', query))
    .toEqual({ kind: "blank" });
  expect(calls).toBe(1);
  expect(calculate('=EXECSQL("owned")', query)).toEqual({ kind: "error", value: "#N/A" });
  expect(calculate('=EXECSQL("owned","","",NA())', query)).toEqual({ kind: "error", value: "#N/A" });
  expect(calls).toBe(1);
});
it("copies host recordset members before downstream functions can mutate them", () => {
  const rows = [[{ kind: "number" as const, value: 2 }]];
  const ports = publicApi.createDatabaseFunctions(() => ({ kind: "recordset", rows }));
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: '=MUTATE(EXECSQL("owned","","","SELECT 1"))', formulaDirty: true, value: { kind: "blank" } }
  ] }] };
  const result = recalculateWorkbook(book, { ...context, runtimeFunctions: { ...ports,
    MUTATE: { signature: "?", implementation(args) {
      rows[0]![0]!.value = 99;
      const value = args[0]; return value?.kind === "matrix" ? value.rows[0]![0]! : { kind: "error", value: "#VALUE!" };
    } }
  } });
  expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2 });
});
it("keeps malformed recordsets and excessive result area under shared runtime admission", () => {
  expect(() => calculate('=EXECSQL("owned","","","SELECT 1")', () => ({ kind: "recordset", rows: [
    [{ kind: "blank" }], []
  ] }))).toThrow("Invalid ssconvert runtime matrix");
  expect(() => calculate('=EXECSQL("owned","","","SELECT 1")', () => ({ kind: "recordset", rows: [
    Array.from({ length: 1001 }, () => ({ kind: "blank" as const }))
  ] }))).toThrow("runtime matrix cell limit exceeded");
});
it("retains cancellation raised by the host instead of publishing its recordset", () => {
  const controller = new AbortController(), reason = new Error("cancel query");
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: '=EXECSQL("owned","","","SELECT 1")', formulaDirty: true, value: { kind: "blank" } }
  ] }] };
  expect(() => recalculateWorkbook(book, { ...context, signal: controller.signal, runtimeFunctions: publicApi.createDatabaseFunctions(() => {
    controller.abort(reason); return { kind: "recordset", rows: [[{ kind: "number", value: 1 }]] };
  }) })).toThrow(reason);
});
it("keeps independently supplied capabilities isolated between registrations", () => {
  expect(calculate('=EXECSQL("owned","","","SELECT 1")', () => ({ kind: "recordset", rows: [[{ kind: "number", value: 4 }]] })))
    .toEqual({ kind: "number", value: 4 });
  expect(calculate('=EXECSQL("owned","","","SELECT 1")', () => ({ kind: "recordset", rows: [[{ kind: "number", value: 9 }]] })))
    .toEqual({ kind: "number", value: 9 });
});
