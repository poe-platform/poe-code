import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [zone, expected] of [
  ["UTC", "22:13 UTC"],
  ["Asia/Tokyo", "07:13 JST"],
] as const) {
  test(`strflocaltime uses the command's TZ=${zone}`, async () => {
    const result = await run(["-nc", '1700000000 | strflocaltime("%H:%M %Z")'], "", {}, { env: { TZ: zone } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${JSON.stringify(expected)}\n`);
  });
}

test("strflocaltime defaults to UTC independently of the host timezone", async () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    const result = await run(["-nc", '1700000000 | strflocaltime("%H:%M %Z")']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '"22:13 UTC"\n');
    assert.equal(process.env.TZ, "America/Chicago");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("strftime remains UTC when the command sets TZ", async () => {
  const result = await run(["-nc", '1700000000 | strftime("%H:%M %Z")'], "", {}, { env: { TZ: "Asia/Tokyo" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '"22:13 UTC"\n');
});
