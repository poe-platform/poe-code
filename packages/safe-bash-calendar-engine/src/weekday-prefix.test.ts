import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone, weekdayNames } from "./time-env/calendar.js";

for (const input of ["Fri, 5 Jan 2024", "Friday January 5 2024", "fri 2024-01-05"]) {
  test(`parses a leading weekday in ${input}`, () => {
    assert.equal(parseDate(input, new TimeZone("UTC"), () => 0n), 1704412800000000000n);
  });
}

test("weekday prefixes preserve source timezones, fractions, and relative suffixes", () => {
  const zone = new TimeZone("America/New_York");
  assert.equal(parseDate("FRIDAY, January 5 2024", zone, () => 0n), 1704430800000000000n);
  assert.equal(parseDate("Fri, 2024-01-05 00:15:00.123456789 +0530", zone, () => 0n), 1704393900123456789n);
  assert.equal(parseDate("Fri 5 Jan 2024 1 day", zone, () => 0n), 1704517200000000000n);
});

test("weekday-prefixed dates retain calendar and weekday validation", () => {
  for (const input of ["Fry 2024-01-05", "Fri Fri 2024-01-05", "Fri, 30 Feb 2024", "Thu, 5 Jan 2024", "Thursday January 5 2024", "fri 2024-01-05 junk", "Fri @1704412800"]) {
    assert.throws(() => parseDate(input, new TimeZone("UTC"), () => 0n), input);
  }
});

test("accepts full and abbreviated names for every weekday", () => {
  const zone = new TimeZone("UTC");
  for (const [index, name] of weekdayNames.entries()) {
    const date = `2024-01-0${index || 7}`;
    const expected = parseDate(date, zone, () => 0n);
    for (const prefix of [name, name.slice(0, 3).toLowerCase() + ","]) {
      assert.equal(parseDate(`${prefix} ${date}`, zone, () => 0n), expected);
    }
  }
});
