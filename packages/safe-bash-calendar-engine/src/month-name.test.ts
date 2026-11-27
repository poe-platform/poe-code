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
