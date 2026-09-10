import { expect, it } from "vitest";
import { parseTemporalCalendarString } from "./temporal-time-zone-string.js";

it.each([
  ["iso8601", "iso8601"], ["BUDDHIST", "BUDDHIST"], ["unknown-calendar", "unknown-calendar"],
  ["2020-02-30", "2020-02-30"], ["2020-13-01", "2020-13-01"],
  ["2020-01-01", "iso8601"], ["2020-01", "iso8601"], ["01-01", "iso8601"],
  ["2016-12-31T23:59:60", "iso8601"], ["12:34", "iso8601"],
  ["+999999-01-01[u-ca=buddhist]", "buddhist"],
  ["2020-01-01T00:00[UTC][u-ca=hebrew]", "hebrew"]
])("extracts a calendar from %s", (input, expected) => {
  expect(parseTemporalCalendarString(input)).toBe(expected);
});

it.each(["", "2020-01-01T00:00+01:60",
  "2020-01-01T24:00", "2020-01[u-ca=buddhist]", "iso_8601", "iso--8601",
  "2020-01-01[!foo=bar]"])("rejects malformed calendar syntax %j", input => {
  expect(() => parseTemporalCalendarString(input)).toThrow(RangeError);
});
