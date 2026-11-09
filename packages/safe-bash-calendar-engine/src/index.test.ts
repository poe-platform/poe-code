import assert from "node:assert/strict";
import { test } from "node:test";
import { floorDivide, TimeZone } from "./time-env/calendar.js";
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
