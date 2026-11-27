import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";

for (const [input, expected] of [
  ["1/5/2024", "2024-01-05T00:00:00"],
  ["01/05/24", "2024-01-05T00:00:00"],
  ["2024/01/05", "2024-01-05T00:00:00"],
  ["24-01-05", "2024-01-05T00:00:00"],
  ["2024-1-5 3:04", "2024-01-05T03:04:00"],
  ["1/5/68", "2068-01-05T00:00:00"],
  ["69-01-05", "1969-01-05T00:00:00"],
  ["00-01-05", "2000-01-05T00:00:00"],
  ["0069-01-05", "0069-01-05T00:00:00"],
  ["20240105", "2024-01-05T00:00:00"],
  ["1/5/2024 3:04:05 +0200", "2024-01-05T01:04:05"],
  ["2024/1/5 next day", "2024-01-06T00:00:00"],
] as const) {
  test(`numeric date: ${input}`, () => {
    const zone = new TimeZone("UTC");
    assert.equal(formatDate("%FT%T", parseDate(input, zone, () => 0n), zone, settings({}).limits), `${expected}\n`);
  });
}

for (const input of ["2/30/2024", "13/5/2024", "2024/0/5", "24-02-30", "2024-1-5 24:04", "2024/01-05", "1/5/2024junk"]) {
  test(`reject invalid numeric date: ${input}`, () => {
    assert.throws(() => parseDate(input, new TimeZone("UTC"), () => 0n));
  });
}
