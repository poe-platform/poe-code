import assert from "node:assert/strict";
import { test } from "node:test";
import { floorDivide, TimeZone } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";
test("negative epochs use floor division", () => { assert.equal(floorDivide(-1n, 1000000000n), -1n); assert.equal(floorDivide(1000000001n, 1000000000n), 1n); });

for (const name of ["Asia/Kolkata", "Asia/Calcutta", ":Asia/Kolkata"]) {
  test(`${name} uses the native Indian standard time abbreviation`, () => {
    assert.deepEqual(new TimeZone(name).fields(0n), {
      year: 1970, month: 1, day: 1, hour: 5, minute: 30, second: 0, offset: 19800, zone: "IST"
    });
  });
}

test("Kolkata abbreviation does not replace historical offsets or other zones", () => {
  const historical = new TimeZone("Asia/Kolkata").fields(BigInt(Date.UTC(1900, 0, 1)) * 1000000n);
  assert.equal(historical.offset, 19270);
  assert.notEqual(historical.zone, "IST");
  assert.notEqual(new TimeZone("Asia/Colombo").fields(0n).zone, "IST");
  assert.equal(new TimeZone("UTC0").fields(0n).zone, "UTC");
  const newYork = new TimeZone("America/New_York");
  assert.equal(newYork.fields(0n).zone, "EST");
  assert.equal(newYork.fields(BigInt(Date.UTC(2024, 6, 1)) * 1000000n).zone, "EDT");
});

for (const [name, seconds, expected] of [
  ["Europe/Berlin", 1720000000, "2024-07-03 11:46:40 +0200 CEST"],
  ["Europe/Berlin", 1730613600, "2024-11-03 07:00:00 +0100 CET"],
  [":Europe/Berlin", 1710054000, "2024-03-10 08:00:00 +0100 CET"],
  ["Europe/Berlin", 1711846799, "2024-03-31 01:59:59 +0100 CET"],
  ["Europe/Berlin", 1711846800, "2024-03-31 03:00:00 +0200 CEST"],
  ["Europe/Berlin", 1729990799, "2024-10-27 02:59:59 +0200 CEST"],
  ["Europe/Berlin", 1729990800, "2024-10-27 02:00:00 +0100 CET"],
  ["Asia/Tokyo", 0, "1970-01-01 09:00:00 +0900 JST"],
  ["Japan", 0, "1970-01-01 09:00:00 +0900 JST"],
  ["Asia/Kolkata", 0, "1970-01-01 05:30:00 +0530 IST"]
] as const) {
  test(`${name} at ${seconds} formats native zone abbreviations`, () => {
    assert.equal(formatDate("%F %T %z %Z", BigInt(seconds) * 1000000000n,
      new TimeZone(name), settings({}).limits), `${expected}\n`);
  });
}
