import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";

const zone = new TimeZone("UTC");
for (const [input, format, expected] of [
  ["Jan 5 2024", "%F", "2024-01-05"],
  ["5 Jan 2024", "%F", "2024-01-05"],
  ["5-Jan-2024", "%F", "2024-01-05"],
  ["January 5, 2024 3pm", "%FT%T", "2024-01-05T15:00:00"],
  ["Fri Jan  5 10:20:30 UTC 2024", "%s", "1704450030"],
  ["5 january 2024 10:20:30 +0200", "%T", "08:20:30"],
  ["Jan 5 2024 tomorrow", "%F", "2024-01-06"],
] as const) {
  test(`month-name date: ${input}`, () => {
    assert.equal(formatDate(format, parseDate(input, zone, () => 0n), zone, settings({}).limits), `${expected}\n`);
  });
}

test("month-name dates reject invalid fields and unknown months", () => {
  for (const input of ["Feb 30 2024", "Janu 5 2024", "Jan 5 2024 13pm", "Jan 5 2024 garbage"]) {
    assert.throws(() => parseDate(input, zone, () => 0n));
  }
});

for (const [input, expected] of [
  ["jAnUaRy 5, 2024 12am", "2024-01-05T00:00:00Z"],
  ["5 JAN 2024 12 PM", "2024-01-05T12:00:00Z"],
  ["5-January-2024 3:04:05pm", "2024-01-05T15:04:05Z"],
  ["February 29, 2024", "2024-02-29T00:00:00Z"],
  ["Jan 5 2024 10:20:30 +0530", "2024-01-05T04:50:30Z"],
  ["Fri Jan  5 10:20:30 +0530 2024", "2024-01-05T04:50:30Z"],
  ["Fri, 5 Jan 2024 10:20:30 +0530", "2024-01-05T04:50:30Z"],
  ["Jan 5 2024 1 day", "2024-01-06T00:00:00Z"],
] as const) {
  test(`parses month names in ${input}`, () => {
    assert.equal(parseDate(input, new TimeZone("UTC"), () => 0n), BigInt(Date.parse(expected)) * 1000000n);
  });
}

test("month-name dates use virtual TZ unless an explicit zone is supplied", () => {
  const zone = new TimeZone("America/New_York");
  assert.equal(parseDate("Jan 5 2024", zone, () => 0n), 1704430800000000000n);
  assert.equal(parseDate("Jan 5 2024 00:00 UTC", zone, () => 0n), 1704412800000000000n);
  assert.throws(() => parseDate("March 10 2024 02:30", zone, () => 0n), /nonexistent local time/);
  assert.equal(parseDate("November 3 2024 01:30", zone, () => 0n), 1730611800000000000n);
});

for (const input of ["Feb 30 2024", "February 29 2023", "Jan 0 2024", "Jan 32 2024", "Janu 5 2024",
  "Jan 5 2024 0am", "Jan 5 2024 13pm", "Jan 5 2024 24:00", "Jan 5 2024 10:60", "Jan 5 2024 10:20:60",
  "Jan 5 2024 junk", "Fri Jan 5 10:20:30 UTC 2024 junk", "Thu Jan 5 10:20:30 UTC 2024"]) {
  test(`rejects invalid month-name date ${input}`, () => {
    assert.throws(() => parseDate(input, new TimeZone("UTC"), () => 0n));
  });
}
