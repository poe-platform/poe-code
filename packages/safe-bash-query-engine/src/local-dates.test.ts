import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

for (const [zone, input, expected] of [
  ["UTC", 0, "1970-01-01 00:00:00 +0000 UTC 0"],
  ["America/New_York", 0, "1969-12-31 19:00:00 -0500 EST 0"],
  ["America/New_York", 1719835200, "2024-07-01 08:00:00 -0400 EDT 1719835200"],
  ["Asia/Kolkata", 0, "1970-01-01 05:30:00 +0530 GMT+5:30 0"],
  ["America/New_York", [1970, 0, 1, 0, 0, 0, 4, 0], "1970-01-01 00:00:00 -0500 EST 18000"],
  ["UTC", [1970, 0, 1, 0, 0, 0, 4, 0], "1970-01-01 00:00:00 +0000 UTC 0"],
] as const) {
  test(`strflocaltime formats ${JSON.stringify(input)} in ${zone}`, async () => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      session.compileOnce('strflocaltime("%F %T %z %Z %s")');
      const values = [];
      for await (const value of session.run(JSON.parse(JSON.stringify(input)))) values.push(value);
      assert.deepEqual(values, [expected]);
    } finally {
      await session.close();
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
}

test("strflocaltime evaluates format streams and enforces value limits", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal, limits: { maxValueBytes: 20 } });
  try {
    session.compileOnce('strflocaltime("literal", "%Y%Y%Y%Y%Y%Y")');
    const stream = session.run(0);
    assert.equal((await stream.next()).value, "literal");
    await assert.rejects(stream.next(), /maxValueBytes/);
  } finally { await session.close(); }
});

for (const filter of ['strflocaltime(1)', 'null | strflocaltime("%F")', '[] | strflocaltime("%F")']) {
  test(`strflocaltime rejects invalid input: ${filter}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      session.compileOnce(filter);
      await assert.rejects(session.run(0).next(), /strflocaltime/);
    } finally { await session.close(); }
  });
}
