import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [zone, filter, expected] of [
  ["Asia/Tokyo", "1700000000 | localtime", "[2023,10,15,7,13,20,3,318]\n"],
  ["Asia/Tokyo", '1700000000 | localtime | strftime("%F %T")', '"2023-11-15 07:13:20"\n'],
  ["Asia/Tokyo", "1700000000 | localtime | mktime", "1700032400\n"],
  ["UTC", "1700000000 | localtime", "[2023,10,14,22,13,20,2,317]\n"],
  ["America/New_York", "0 | localtime", "[1969,11,31,19,0,0,3,364]\n"],
  ["America/New_York", "1719835200 | localtime", "[2024,6,1,8,0,0,1,182]\n"],
  ["Asia/Kolkata", "0 | localtime", "[1970,0,1,5,30,0,4,0]\n"],
  ["UTC", "-0.5 | localtime", "[1970,0,1,0,0,0.5,4,0]\n"],
  ["Asia/Tokyo", "1700000000.25 | localtime", "[2023,10,15,7,13,20.25,3,318]\n"],
] as const) {
  test(`jq localtime uses command TZ=${zone}: ${filter}`, async () => {
    const previous = process.env.TZ;
    const result = await run(["-nc", filter], "", {}, { cwd: "/work", env: { TZ: zone } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(process.env.TZ, previous);
  });
}
