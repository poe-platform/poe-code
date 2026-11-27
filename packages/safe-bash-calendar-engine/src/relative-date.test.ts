import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone } from "./time-env/calendar.js";

const zone = new TimeZone("UTC");
const now = () => BigInt(Date.parse("2024-01-05T12:34:56.123Z")) * 1000000n;

for (const [input, expected] of [
  ["2024-01-05 next week", "2024-01-12T00:00:00.000Z"],
  ["2024-01-05 last month", "2023-12-05T00:00:00.000Z"],
  ["2024-01-05 next year", "2025-01-05T00:00:00.000Z"],
  ["2024-01-05 yesterday", "2024-01-04T00:00:00.000Z"],
  ["2024-01-05 tomorrow 10:00", "2024-01-06T10:00:00.000Z"],
  ["2024-01-05 fortnight", "2024-01-19T00:00:00.000Z"],
  ["next month", "2024-02-05T12:34:56.123Z"],
  ["last sunday", "2023-12-31T00:00:00.000Z"],
  ["monday", "2024-01-08T00:00:00.000Z"],
  ["next monday", "2024-01-08T00:00:00.000Z"],
  ["next friday", "2024-01-12T00:00:00.000Z"],
  ["last friday", "2023-12-29T00:00:00.000Z"],
  ["this friday", "2024-01-05T00:00:00.000Z"],
  ["Friday", "2024-01-05T00:00:00.000Z"],
  ["tomorrow 10:00", "2024-01-06T10:00:00.000Z"],
  ["2024-01-05 this month", "2024-01-05T00:00:00.000Z"],
  ["2024-01-05 2 fortnights ago", "2023-12-08T00:00:00.000Z"],
  ["2024-01-31 next month", "2024-03-02T00:00:00.000Z"],
  ["2024-02-29 next year", "2025-03-01T00:00:00.000Z"],
  ["2024-01-05T23:00:00-05:00 tomorrow", "2024-01-07T04:00:00.000Z"],
] as const) {
  test(`relative date: ${input}`, () => {
    assert.equal(parseDate(input, zone, now), BigInt(Date.parse(expected)) * 1000000n);
  });
}

test("relative dates reject invalid times and unknown words", () => {
  for (const input of ["tomorrow 25:00", "next nonsense", "2024-02-30 tomorrow", "monday garbage"]) {
    assert.throws(() => parseDate(input, zone, now));
  }
});
