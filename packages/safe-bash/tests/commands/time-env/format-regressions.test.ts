import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

for (const [format, expected] of [
  ["%12F", "002024-01-02"], ["%#c", "Tue Jan  2 03:04:05 2024"],
  ["%-z", "+0"], ["%_z", "   +0"], ["%_12z", "          +0"], ["%^P", "am"],
  ["%#^p|%^#p|%#^P|%^#P|%#^Z", "am|am|am|am|utc"],
  ["%#A|%#b|%^c|%#r", "TUESDAY|JAN|TUE JAN  2 03:04:05 2024|03:04:05 AM"],
  ["%-:z|%_:z|%-::z|%_::z|%-:::z|%_:::z", "+0:00| +0:00|+0:00:00| +0:00:00|+0| +0"],
  ["%_12F|%-12F|%012F|%_012F|%0_12F", "  2024-01-02|2024-01-02|002024-01-02|002024-01-02|  2024-01-02"],
] as const) {
  test(`date independent-review regression ${format}`, async () => {
    const result = await run("date", ["-d@1704164645.123456789", `+${format}`]);
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, expected + "\n");
  });
}

test("date compound year width belongs to the year, including short years", async () => {
  const result = await run("date", ["-d0008-01-02T03:04:05Z", "+%F|%-F|%_F|%0F|%7F|%8F|%9F|%12F|%_12F|%-12F"]);
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
  assert.equal(result.stdout, "0008-01-02|8-01-02|8-01-02|8-01-02|8-01-02|08-01-02|008-01-02|000008-01-02|     8-01-02|8-01-02\n");
});

test("date explicit D inherits year padding while C-locale x remains opaque", async () => {
  const result = await run("date", ["-d0008-01-02T03:04:05Z", "+%-D|%_D|%0D|%-12D|%_12D|%-x|%_x"]);
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
  assert.equal(result.stdout, "01/02/8|01/02/ 8|01/02/08|01/02/8|    01/02/ 8|01/02/08|01/02/08\n");
});

test("date timezone padding applies to signed numeric offsets, not pre-padded strings", async () => {
  for (const [zone, expected] of [
    ["UTC-0:30:07", "+0030|+30|  +30|+0:30| +0:30|+0:30:07| +0:30:07"],
    ["UTC+0:30:07", "-0030|-30|  -30|-0:30| -0:30|-0:30:07| -0:30:07"],
    ["UTC-5:45", "+0545|+545| +545|+5:45| +5:45|+5:45:00| +5:45:00"],
  ]) {
    const result = await run("date", ["-d@0", "+%z|%-z|%_z|%-:z|%_:z|%-::z|%_::z"], {}, { env: { TZ: zone! } });
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, expected + "\n"); assert.equal(result.stderr, "");
  }
});
