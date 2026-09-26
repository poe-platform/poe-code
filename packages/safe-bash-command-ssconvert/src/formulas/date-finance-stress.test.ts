import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

function calculate(formula: string, dateSystem: Workbook["dateSystem"] = "1900", supplied: Partial<CapabilityContext> = {}, withClock = true) {
  const context: CapabilityContext = {
    signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
    ...(withClock ? { clock: { now: () => 0 } } : {}), own() {}, ...supplied
  };
  const book: Workbook = { dateSystem, sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: { kind: "number", value: 0 }, formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value;
}

// Released fn-date/functions.c: value_get_basis rejects negatives before truncation.
it.each([-0.5, -Number.MIN_VALUE, -1, 5, 6])("rejects inadmissible YEARFRAC basis %s", basis => {
  expect(calculate(`=YEARFRAC(DATE(2024,1,1),DATE(2025,1,1),${basis})`)).toEqual({ kind: "error", value: "#NUM!" });
});
it.each([0, 0.5, 4, 4.999])("retains admissible fractional YEARFRAC basis %s", basis => {
  expect(calculate(`=YEARFRAC(DATE(2024,1,1),DATE(2025,1,1),${basis})`)).toEqual({ kind: "number", value: 1 });
});

// Binary-exact fractions exercise rounding after truncating the serial day.
it.each([
  ["=DATE2UNIX(25569-1/256)", -337],
  ["=DATE2UNIX(25569+1/256)", 338]
] as const)("rounds the fractional serial day before adding its Unix epoch in %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "number", value });
});

// Released value_new_int(int): captured GCC ARM64 double-to-int conversion saturates.
it.each([
  ["=DATE2UNIX(-1-1/256)", -2147483648],
  ["=DATE2UNIX(1+1/256)", -2147483648],
  ["=DATE2UNIX(DATE(2038,1,19)+TIME(3,14,8))", 2147483647]
] as const)("matches captured native integer boundary in %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "number", value });
});

// The 1904 epoch keeps negative fractional serials inside int32, exposing rounding.
it.each([
  ["=DATE2UNIX(-1-1/256)", -2082931538],
  ["=DATE2UNIX(1+1/256)", -2082758062]
] as const)("preserves captured signed fractional rounding in the 1904 system: %s", (formula, value) => {
  expect(calculate(formula, "1904")).toEqual({ kind: "number", value });
});

const hebrewCalendarCases = [
  ["HDATE", { kind: "string", value: "20 Tebet 5784" }],
  ["HDATE_HEB", { kind: "string", value: "כ׳ בְּטֵבֵת התשפ״ד" }],
  ["HDATE_DAY", { kind: "number", value: 20 }],
  ["HDATE_MONTH", { kind: "number", value: 3 }],
  ["HDATE_YEAR", { kind: "number", value: 5784 }],
  ["HDATE_JULIAN", { kind: "number", value: 2460311 }],
  ["DATE2HDATE", { kind: "string", value: "20 Tebet 5784" }],
  ["DATE2HDATE_HEB", { kind: "string", value: "כ׳ בְּטֵבֵת התשפ״ד" }],
  ["DATE2JULIAN", { kind: "number", value: 2460311 }]
] as const;

// Released gnumeric_date_get_date always extracts GDate fields, including defaults.
it.each(["1900", "1904"] as const)("uses only local calendar fields from injected midnight/noon in %s", dateSystem => {
  for (const hour of [0, 12]) for (const [name, value] of hebrewCalendarCases) {
    expect(calculate(`=${name}()`, dateSystem, { clock: { now: () => Date.UTC(2024, 0, 1, hour) } })).toEqual(value);
  }
});
it.each(["1900", "1904"] as const)("uses the configured timezone's preceding local date in %s", dateSystem => {
  for (const [name, value] of hebrewCalendarCases) {
    expect(calculate(`=${name}()`, dateSystem, {
      clock: { now: () => Date.UTC(2024, 0, 2, 2) },
      environment: { env: {}, locale: "C", timezone: "America/New_York" }
    })).toEqual(value);
  }
});
it.each(["1900", "1904"] as const)("ignores explicit fractional serial times without clock authority in %s", dateSystem => {
  for (const [name, value] of hebrewCalendarCases.filter(([name]) => name.startsWith("DATE2"))) {
    expect(calculate(`=${name}(DATE(2024,1,1)+.5)`, dateSystem, {}, false)).toEqual(value);
    expect(calculate(`=${name}(1e100)`, dateSystem, {}, false)).toEqual({ kind: "error", value: "#NUM!" });
  }
  expect(calculate("=DATE2JULIAN(DATE(2024,1,1)+1-.25/86400)", dateSystem, {}, false)).toEqual({ kind: "number", value: 2460312 });
});

it.each(["DATE2HDATE", "DATE2HDATE_HEB", "DATE2JULIAN"])("preserves clock authority, cancellation and admission budgets in %s", name => {
  expect(() => calculate(`=${name}()`, "1900", {}, false)).toThrow("require an explicit clock");
  const controller = new AbortController();
  const reason = new Error("calendar clock cancellation");
  expect(() => calculate(`=${name}()`, "1900", {
    signal: controller.signal,
    clock: { now() { controller.abort(reason); return Date.UTC(2024, 0, 1, 12); } }
  })).toThrow(reason);
  let calls = 0;
  expect(() => calculate(`=${name}()`, "1900", {
    clock: { now() { calls++; return Date.UTC(2024, 0, 1, 12); } },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 0 }
  })).toThrow("workbook work limit exceeded");
  expect(calls).toBe(0);
  expect(calculate(`=${name}()`, "1900", { clock: { now: () => Date.UTC(2024, 0, 1, 12) } })).toEqual(hebrewCalendarCases.find(([candidate]) => candidate === name)![1]);
});
