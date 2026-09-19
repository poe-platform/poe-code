import { expect, test } from "vitest";
import { castValue, inferTable } from "./types.js";
import { writeCsvRow } from "../csv.js";
import { temporalOrder } from "../types/temporal.js";
import lastReference from "../../../../docs/csvkit/temporal-standalone-last-reference.json" with { type: "json" };

test("frozen standalone last is text, including sparse workbook rows", () => {
  const table = inferTable(['value'], [[''], ['last'], ['']], { now: 0, timezone: 'UTC' });
  expect(table.columns[0]?.type).toBe('Text');
  expect(writeCsvRow(table.headers) + writeCsvRow(table.rows[1]!)).toBe(lastReference.stdout);
  expect(lastReference.stderr).toBe('');
  expect(lastReference.status).toBe(0);
});

test("strptime collapses format whitespace and uses Python whitespace characters", () => {
  for (const [input, format] of [["2024 02 29", "%Y  %m  %d"], ["2024\u008502\u008529", "%Y\u0085%m\u0085%d"]] as const) {
    expect(castValue("Date", input, { dateFormat: format })).toEqual({ kind: "date", value: "2024-02-29" });
  }
});

test("aware datetime order includes signed offset seconds and microseconds", () => {
  const midnight = temporalOrder("2024-01-01 00:00:00+00:00");
  expect(temporalOrder("2024-01-01 00:00:00+00:00:00.000001")).toBe(midnight - 1n);
  expect(temporalOrder("2024-01-01 00:00:00-00:00:01.000001")).toBe(midnight + 1000001n);
  expect(temporalOrder("2024-01-01 00:00:00+01:02:03.123456")).toBe(midnight - 3723123456n);
});

test("frozen Agate duration grammar preserves sign bug, clock forms and half-even microseconds", () => {
  for (const [input, micros] of [["1h", 3600000000n], ["12:34", 754000000n], ["|1s", 1000000n], ["-1.5h 2s", -5398000000n], ["0.0000005s", 0n], ["0.0000015s", 2n], ["1w 2d 3:04:05", 788645000000n]] as const) {
    expect(castValue("TimeDelta", input, {})).toEqual({ kind: "timedelta", microseconds: micros });
  }
  expect(() => castValue("TimeDelta", "1..2h", {})).toThrow("ValueError: could not convert string to float: '1..2'");
});

test("Date casts validate Gregorian dates without JS rollover and preserve inference order", () => {
  expect(castValue("Date", "2024-02-29", {})).toEqual({ kind: "date", value: "2024-02-29" });
  expect(castValue("Date", "01/02/2024", {})).toEqual({ kind: "date", value: "2024-01-02" });
  expect(castValue("Date", "tomorrow", {})).toEqual({ kind: "date", value: "0001-01-02" });
  expect(inferTable(["a"], [["2023-02-29"]]).columns[0]?.type).toBe("Text");
  expect(inferTable(["a"], [["20240102"]]).columns[0]?.type).toBe("Number");
  expect(inferTable(["a"], [["20240102"]], { dateFormat: "%Y%m%d" }).columns[0]?.type).toBe("Date");
});

test("explicit strptime formats handle month names, two-digit years and default fields", () => {
  expect(castValue("Date", "29 Feb 24", { dateFormat: "%d %b %y" })).toEqual({ kind: "date", value: "2024-02-29" });
  expect(castValue("DateTime", "2024/02/29 11:03:04.12 PM +0230", { datetimeFormat: "%Y/%m/%d %I:%M:%S.%f %p %z" })).toEqual({ kind: "datetime", value: "2024-02-29 23:03:04.120000+02:30" });
});

test("ISO datetime fallback retains offsets and truncates fractional seconds", () => {
  const result = castValue("DateTime", "2024-01-02T03:04:05.1234567Z", {});
  expect(result).toEqual({ kind: "datetime", value: "2024-01-02 03:04:05.123456+00:00" });
  expect(writeCsvRow([result])).toBe("2024-01-02 03:04:05.123456+00:00\n");
});

test("temporal null policy and unsupported format directives stay explicit", () => {
  for (const type of ["Date", "DateTime", "TimeDelta"] as const) expect(castValue(type, " NA ", {})).toBeNull();
  expect(() => castValue("Date", "2024-W01-1", { dateFormat: "%G-W%V-%u" })).toThrow("strptime directive");
});

test("null matching freezes CPython Unicode 16 rather than Node Unicode 17", () => {
  expect(castValue("Text", "꟎", { nullValues: ["꟏"] })).toBe("꟎");
  expect(castValue("Text", "ΟΣ", { nullValues: ["ος"] })).toBeNull();
  expect(castValue("Text", "AΣ'A", { nullValues: ["aσ'a"] })).toBeNull();
});

test("timedelta float conversion rounds fractional seconds after splitting integer seconds", () => {
  expect(castValue("TimeDelta", "1.0000005s", {})).toEqual({ kind: "timedelta", microseconds: 1000001n });
  expect(castValue("TimeDelta", "1.0000015s", {})).toEqual({ kind: "timedelta", microseconds: 1000001n });
});

test("duration accepts Python Unicode decimal digits and whitespace", () => {
  expect(castValue("TimeDelta", "١h\u001c٢m", {})).toEqual({ kind: "timedelta", microseconds: 3720000000n });
});

test("DateTime relative source dates use the injected clock while Date uses year one", () => {
  expect(castValue("DateTime", "tomorrow", { now: 0, timezone: "UTC" })).toEqual({ kind: "datetime", value: "1970-01-02 00:00:00" });
  expect(castValue("Date", "tomorrow", { now: 0 })).toEqual({ kind: "date", value: "0001-01-02" });
  expect(() => castValue("DateTime", "today", {})).toThrow("injected clock");
});

test("strptime width alternatives and required whitespace follow frozen CPython", () => {
  expect(castValue("Date", "2024131", { dateFormat: "%Y%m%d" })).toEqual({ kind: "date", value: "2024-01-31" });
  expect(() => castValue("Date", "20240229", { dateFormat: "%Y %m %d" })).toThrow('does not match date format');
});

test("parsedatetime two-digit years use its own century pivot", () => {
  expect(castValue("Date", "1/2/68", {})).toEqual({ kind: "date", value: "1968-01-02" });
});

test("implicit Date preserves nlp absence error separately from invalid date rejection", () => {
  expect(() => castValue("Date", "hello", {})).toThrow('Value "hello" does not match date format.');
  expect(() => castValue("Date", "2023-02-29", {})).toThrow('Can not parse value "2023-02-29" as date.');
});

test("partial DateTime dates require the injected source clock", () => {
  expect(() => castValue("DateTime", "1/2", {})).toThrow("injected clock");
});

test("zero timezone offsets normalize negative zero like Python timezone", () => {
  expect(castValue("DateTime", "2024-01-02T03:04:05-00:00", {})).toEqual({ kind: "datetime", value: "2024-01-02 03:04:05+00:00" });
});
