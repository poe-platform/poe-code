import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone } from "./time-env/calendar.js";

const now = () => BigInt(Date.parse("2024-01-05T12:34:56Z")) * 1000000n;
for (const [input, expected] of [
  ["2024-01-05 + 3 days 2 hours", "2024-01-08T02:00:00Z"],
  ["2024-01-05 +1 day +1 day", "2024-01-07T00:00:00Z"],
  ["2024-01-05 1 day ago 2 hours ago", "2024-01-03T22:00:00Z"],
  ["2024-01-05 -3days", "2024-01-02T00:00:00Z"],
  ["2024-01-05 1 sec", "2024-01-05T00:00:01Z"],
  ["2024-01-05 +1 Day", "2024-01-06T00:00:00Z"],
  ["-1day", "2024-01-04T12:34:56Z"],
  ["10 min ago", "2024-01-05T12:24:56Z"],
  ["2024-01-05 +1day+2hours", "2024-01-06T02:00:00Z"],
  ["2024-01-05 1 day 2 hours ago", "2024-01-05T22:00:00Z"],
  ["2024-01-05 1 fortnight 2 weeks", "2024-02-02T00:00:00Z"],
  ["2024-01-05 1 HR 2 MINS 3 SECS AGO", "2024-01-05T01:01:57Z"],
  ["2024-01-31 1 month 1 month", "2024-03-31T00:00:00Z"],
  ["2024-02-29 1 year -1 month", "2025-01-29T00:00:00Z"],
] as const) {
  test(`relative date items: ${input}`, () => {
    assert.equal(parseDate(input, new TimeZone("UTC"), now), BigInt(Date.parse(expected)) * 1000000n);
  });
}

test("relative items retain the source timezone and subsecond precision", () => {
  assert.equal(parseDate("2024-03-09T12:00:00.123456789 1 day 2 hours", new TimeZone("America/New_York"), now),
    BigInt(Date.parse("2024-03-10T18:00:00Z")) * 1000000n + 123456789n);
  assert.equal(parseDate("2024-01-05T00:00:00.123456789+02:00 1 day 2 hours", new TimeZone("UTC"), now),
    BigInt(Date.parse("2024-01-06T00:00:00Z")) * 1000000n + 123456789n);
});

for (const input of ["1 day garbage 2 hours", "1 minuteish", "1 day ago ago", "1.5 days", "999999999999999day", "1 day +", "2024-02-30 1 day"]) {
  test(`invalid relative date items: ${input}`, () => {
    assert.throws(() => parseDate(input, new TimeZone("UTC"), now));
  });
}
