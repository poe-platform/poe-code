import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone } from "./time-env/calendar.js";

const now = () => BigInt(Date.parse("2024-07-01T12:00:00Z")) * 1000000n;

for (const [input, expected] of [
  ["Jan 5", "2024-01-05T00:00:00Z"],
  ["5 Jan", "2024-01-05T00:00:00Z"],
  ["Dec 25 10:30", "2024-12-25T10:30:00Z"],
  ["25 December 10:30", "2024-12-25T10:30:00Z"],
  ["February 29", "2024-02-29T00:00:00Z"],
  ["Jan 5 10:30 +0200", "2024-01-05T08:30:00Z"],
] as const) {
  test(`month-name date defaults to the current year: ${input}`, () => {
    assert.equal(parseDate(input, new TimeZone("UTC"), now), BigInt(Date.parse(expected)) * 1000000n);
  });
}

test("yearless month-name dates use the virtual timezone's current year", () => {
  const newYear = () => BigInt(Date.parse("2025-01-01T00:30:00Z")) * 1000000n;
  assert.equal(parseDate("Jan 5", new TimeZone("America/New_York"), newYear),
    BigInt(Date.parse("2024-01-05T05:00:00Z")) * 1000000n);
  assert.equal(parseDate("Jan 5", new TimeZone("UTC"), newYear),
    BigInt(Date.parse("2025-01-05T00:00:00Z")) * 1000000n);
  assert.throws(() => parseDate("Feb 29", new TimeZone("UTC"), newYear));
});

for (const input of ["Feb 30", "Jan 0", "Jan 32", "Janu 5", "Jan 5 24:00", "Jan 5 junk"]) {
  test(`rejects invalid yearless month-name date: ${input}`, () => {
    assert.throws(() => parseDate(input, new TimeZone("UTC"), now));
  });
}
