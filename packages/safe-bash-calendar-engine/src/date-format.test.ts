import assert from "node:assert/strict";
import { test } from "node:test";
import { TimeZone } from "./time-env/calendar.js";
import { formatDate } from "./time-env/format.js";
import { settings } from "./time-env/shared.js";

for (const format of ["100%", "%Q", "%+", "%E", "%Q|%+|%E"]) {
  test(`date preserves literal format ${format}`, () => {
    assert.equal(formatDate(format, 0n, new TimeZone("UTC"), settings({}).limits), `${format}\n`);
  });
}

test("literal date conversions still obey the output limit", () => {
  assert.throws(() => formatDate("%Q", 0n, new TimeZone("UTC"),
    settings({ limits: { maxOutputBytes: 2 } }).limits), { code: "EFBIG" });
});
