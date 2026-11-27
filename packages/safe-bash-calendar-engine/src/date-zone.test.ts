import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";

test("ambiguous New York date selects the first occurrence", () => {
  const zone = new TimeZone("America/New_York");
  const instant = parseDate("2024-11-03 01:30", zone, () => 0n);
  assert.equal(formatDate("%s %Z", instant, zone, settings({}).limits), "1730611800 EDT\n");
});

for (const [input, format, expected] of [
  ["2024-01-05 10:20:30 EST", "%FT%T", "2024-01-05T15:20:30"],
  ["2024-01-05 10:20:30 PDT", "%FT%T", "2024-01-05T17:20:30"],
  ["2024-01-05 10:20:30 CET", "%FT%T", "2024-01-05T09:20:30"],
  ["2024-01-05 10:20:30 UTC+2", "%FT%T", "2024-01-05T08:20:30"],
  ["05 Jan 2024 10:20:30 EST", "%s", "1704468030"],
  ["2024-07-05 10:20:30 EST", "%FT%T", "2024-07-05T15:20:30"],
  ["2024-01-05 10:20:30 JST", "%FT%T", "2024-01-05T01:20:30"],
  ["2024-01-05 10:20:30 UTC-5:30", "%FT%T", "2024-01-05T15:50:30"],
  ["05 Jan 2024 10:20:30 GMT+02", "%FT%T", "2024-01-05T08:20:30"],
  ["2024-01-05 10:20:30 +0230", "%FT%T", "2024-01-05T07:50:30"]
] as const) {
  test(`absolute date zone: ${input}`, () => {
    const instant = parseDate(input, new TimeZone("UTC"), () => 0n);
    assert.equal(formatDate(format, instant, new TimeZone("UTC"), settings({}).limits), `${expected}\n`);
  });
}

for (const suffix of ["UNKNOWN", "UTC+24", "UTC+2:60", "UTC+", "UTC+200"]) {
  test(`reject invalid date zone ${suffix}`, () => {
    assert.throws(() => parseDate(`2024-01-05 10:20:30 ${suffix}`, new TimeZone("UTC"), () => 0n));
  });
}
