import assert from "node:assert/strict";
import { test } from "node:test";
import { TimeZone } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";

for (const [name, seconds, expected] of [
  ["Australia/Sydney", 1719756000, "AEST"],
  ["America/St_Johns", 1704412800, "NST"],
  ["Europe/Paris", 1720000000, "CEST"],
  ["Asia/Shanghai", 0, "CST"],
  ["Australia/Sydney", 1704412800, "AEDT"],
  ["America/St_Johns", 1720000000, "NDT"],
  ["Europe/Paris", 1704412800, "CET"],
  [":Australia/NSW", 1719756000, "AEST"],
  ["Asia/Kathmandu", 1720000000, "+0545"],
  ["Asia/Kolkata", -2208988800, "MMT"],
  ["Europe/Paris", -2208988800, "PMT"],
  ["Australia/Sydney", 1712419199, "AEDT"],
  ["Australia/Sydney", 1712419200, "AEST"],
  ["Australia/Sydney", 2524608000, "AEDT"],
  ["Australia/Sydney", 2540246400, "AEST"],
] as const) {
  test(`${name} at ${seconds} uses the tzdb abbreviation`, () => {
    assert.equal(formatDate("%Z", BigInt(seconds) * 1000000000n,
      new TimeZone(name), settings({}).limits), `${expected}\n`);
  });
}
