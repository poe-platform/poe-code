import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, TimeZone } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";

for (const name of ["Nope/Zone", ":Nope/Zone", "America/Nope"]) {
  test(`unknown timezone ${name} formats and parses as UTC`, () => {
    const zone = new TimeZone(name);
    assert.equal(formatDate("%z %T", 0n, zone, settings({}).limits), "+0000 00:00:00\n");
    assert.equal(parseDate("1970-01-01 00:00:00", zone, () => 0n), 0n);
  });
}
