import assert from "node:assert/strict";
import { test } from "node:test";
import { TimeZone, nanosecondsPerSecond } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";

for (const [zone, epoch, expected] of [
  ["EST5EDT,M3.2.0/2,M11.1.0/2", 1710053999, "2024-03-10 01:59:59 -0500 EST"],
  ["EST5EDT,M3.2.0/2,M11.1.0/2", 1710054000, "2024-03-10 03:00:00 -0400 EDT"],
  ["EST5EDT,M3.2.0/2,M11.1.0/2", 1730613599, "2024-11-03 01:59:59 -0400 EDT"],
  ["EST5EDT,M3.2.0/2,M11.1.0/2", 1730613600, "2024-11-03 01:00:00 -0500 EST"],
  ["ACST-9:30ACDT,M10.1.0,M4.1.0/3", 1720000000, "2024-07-03 19:16:40 +0930 ACST"],
  ["America/New_York", 1710054000, "2024-03-10 03:00:00 -0400 EDT"],
  ["America/New_York", 1730613600, "2024-11-03 01:00:00 -0500 EST"],
  ["CET-1", 1720000000, "2024-07-03 10:46:40 +0100 CET"],
] as const) {
  test(`${zone} at ${epoch}`, () => {
    assert.equal(formatDate("%F %T %z %Z", BigInt(epoch) * nanosecondsPerSecond,
      new TimeZone(zone), settings({}).limits), `${expected}\n`);
  });
}

for (const [zone, date, offset, label] of [
  ["ACST-9:30ACDT,M10.1.0,M4.1.0/3", "2024-01-01T00:00:00Z", 37800, "ACDT"],
  ["ACST-9:30ACDT,M10.1.0,M4.1.0/3", "2024-04-06T16:29:59Z", 37800, "ACDT"],
  ["ACST-9:30ACDT,M10.1.0,M4.1.0/3", "2024-04-06T16:30:00Z", 34200, "ACST"],
  ["ACST-9:30ACDT,M10.1.0,M4.1.0/3", "2024-10-05T16:29:59Z", 34200, "ACST"],
  ["ACST-9:30ACDT,M10.1.0,M4.1.0/3", "2024-10-05T16:30:00Z", 37800, "ACDT"],
  [":<+10>-10<+1030>-10:30,M10.1.0,M4.1.0", "2024-01-01T00:00:00Z", 37800, "+1030"],
  ["CET-1CEST,M3.5.0,M10.5.0/3", "2024-03-31T00:59:59Z", 3600, "CET"],
  ["CET-1CEST,M3.5.0,M10.5.0/3", "2024-03-31T01:00:00Z", 7200, "CEST"],
  ["CET-1CEST,M3.5.0,M10.5.0/3", "2023-03-26T01:00:00Z", 7200, "CEST"],
  ["STD0DST,J60/0,J300/0", "2024-02-29T00:00:00Z", 0, "STD"],
  ["STD0DST,J60/0,J300/0", "2024-03-01T00:00:00Z", 3600, "DST"],
  ["STD0DST,59/0,300/0", "2024-02-29T00:00:00Z", 3600, "DST"],
  ["STD0DST,59/0,300/0", "2023-02-28T00:00:00Z", 0, "STD"],
  ["STD0DST,0/-2,180/26:30:15", "2023-12-31T22:00:00Z", 3600, "DST"],
] as const) {
  test(`${zone} transition at ${date}`, () => {
    const fields = new TimeZone(zone).fields(BigInt(Date.parse(date)) * 1000000n);
    assert.ok(fields.offset === offset, `expected offset ${offset}, got ${fields.offset}`);
    assert.equal(fields.zone, label);
  });
}

test("POSIX zones retain local time gap and fold handling", () => {
  const zone = new TimeZone("EST5EDT,M3.2.0/2,M11.1.0/2");
  const gap = { year: 2024, month: 3, day: 10, hour: 2, minute: 30, second: 0 };
  const fold = { year: 2024, month: 11, day: 3, hour: 1, minute: 30, second: 0 };
  assert.throws(() => zone.instant(gap), /nonexistent local time/);
  assert.throws(() => zone.instant(fold), /ambiguous local time/);
  assert.equal(zone.instant(gap, 0n, "compatible"), 1710055800n * nanosecondsPerSecond);
  assert.equal(zone.instant(fold, 0n, "compatible"), 1730611800n * nanosecondsPerSecond);
});

for (const rules of ["M0.1.0,M11.1.0", "M3.6.0,M11.1.0", "M3.2.7,M11.1.0", "J0,J300",
  "J366,J300", "366,300", "M3.2.0/168,M11.1.0", "M3.2.0/2:60,M11.1.0", "M3.2.0", "M3.2.0,M11.1.0,extra"]) {
  test(`rejects malformed POSIX rules ${rules}`, () => {
    assert.throws(() => new TimeZone(`EST5EDT,${rules}`), /unsupported virtual TZ/);
  });
}
