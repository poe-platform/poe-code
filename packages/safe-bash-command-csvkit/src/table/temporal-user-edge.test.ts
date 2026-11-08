import { expect, test } from "vitest";
import { castValue, inferTable, CastError } from "./types.js";
import hypothesisReference from "../../../../docs/csvkit/hypothesis-cast-reference.json" with { type: "json" };
import type { ColumnType } from "./types.js";

for (const item of hypothesisReference.casts) test(`frozen hypothesis cast: ${item.type} ${item.input}`, () => {
  const cast = () => castValue(item.type as ColumnType, item.input, { now: 0, timezone: "UTC" });
  if (item.result.kind === "exception") {
    let failure: unknown;
    try { cast(); } catch (caught) { failure = caught; }
    expect(failure).toBeInstanceOf(item.result.name === "CastError" ? CastError : Error);
    expect((failure as Error).message).toBe(item.result.name === "CastError" ? item.result.message : `${item.result.name}: ${item.result.message}`);
  } else {
    const value = item.result.value!;
    expect(cast()).toEqual(value.kind === "timedelta" ? { kind: value.kind, microseconds: BigInt(value.microseconds!) } : value);
  }
});

test("implicit numeric dates follow frozen parsedatetime field order and year pivot", () => {
  for (const [input, value] of [
    ["0001-01-01", "2001-01-01"], ["0002-01-01", "2001-02-01"],
    ["0012-03-04", "2004-12-03"], ["0049-03-04", "2049-03-04"],
    ["0050-03-04", "1950-03-04"], ["0099-03-04", "1999-03-04"],
    ["0100-03-04", "0100-03-04"], ["0999-03-04", "0999-03-04"]
  ]) expect(castValue("Date", input!, {})).toEqual({ kind: "date", value });
  expect(() => castValue("Date", "0013-03-04", {})).toThrow("Can not parse value");
  expect(castValue("Date", "0001-01-01", { dateFormat: "%Y-%m-%d" })).toEqual({ kind: "date", value: "0001-01-01" });
});

test("implicit month dates normalize Python whitespace internally", () => {
  for (const separator of ["\u00a0", "\u0085", "\u2003", "\t"]) {
    expect(castValue("Date", `January${separator}2 2024`, {})).toEqual({ kind: "date", value: "2024-01-02" });
  }
});

test("pytimeparse unit matching includes Python IGNORECASE special letters", () => {
  for (const [input, microseconds] of [["1 mİn", 60000000n], ["1 weeK", 604800000000n]] as const) {
    expect(castValue("TimeDelta", input, {})).toEqual({ kind: "timedelta", microseconds });
  }
});

test("direct TimeDelta casts accept Unicode units independently of Date hypotheses", () => {
  expect(castValue("TimeDelta", "1 ſec", {})).toEqual({ kind: "timedelta", microseconds: 1000000n });
  expect(castValue("TimeDelta", "1 mın", {})).toEqual({ kind: "timedelta", microseconds: 60000000n });
});

test("Agate inference evaluates surviving hypotheses even when an earlier type accepts", () => {
  expect(() => inferTable(["d"], [["1 ſec"]])).toThrow("KeyError: 'ſec'");
  // An earlier plain-text row eliminates temporal hypotheses before the unit.
  expect(inferTable(["d"], [["ordinary text"], ["1 ſec"]]).columns).toEqual([{ name: "d", type: "Text" }]);
  expect(() => inferTable(["d"], [["1 ſec"], ["ordinary text"]])).toThrow("KeyError: 'ſec'");
  expect(inferTable(["d"], [["1 ſec"]], { noInference: true }).rows).toEqual([["1 ſec"]]);
});

test("parsedatetime preserves Unicode unit-key lookup failures", () => {
  for (const unit of ["ſ", "ſec", "ſeconds", "minuteſ", "mın", "mınutes", "weekſ"]) {
    expect(() => castValue("Date", `1 ${unit}`, {})).toThrow(`KeyError: '${unit}'`);
  }
  expect(() => castValue("Date", "1 mİn", {})).toThrow("does not match date format");
});

test("unused temporal hypotheses reject scientific numbers and subday units normally", () => {
  for (const input of ["1h", "2 hours", "1 minute", "1e10000", "1e-2"]) {
    expect(() => castValue("Date", input, {})).toThrow(CastError);
    expect(() => castValue("DateTime", input, {})).toThrow(CastError);
  }
  expect(castValue("Date", "1 day", {})).toEqual({ kind: "date", value: "0001-01-02" });
  expect(castValue("DateTime", "1 week", { now: 0, timezone: "UTC" })).toEqual({ kind: "datetime", value: "1970-01-08 00:00:00" });
});
