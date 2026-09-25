import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

test("shared queries retain decimal arithmetic and stream order", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  session.compileOnce(".[] | . + 0.1");
  try {
    const values: string[] = [];
    for await (const value of session.run([1, 2])) values.push(await session.ownedWork.stringifyJson(value, { pretty: false, maxBytes: 100, limitName: "maxValueBytes" }));
    assert.deepEqual(values, ["1.1", "2.1"]);
  } finally { await session.close(); }
  await assert.rejects(session.run(null).next(), /closed/);
});

test("query cancellation preserves the original falsey reason", async () => {
  const controller = new AbortController();
  const session = createYqQuerySession({ signal: controller.signal });
  session.compileOnce(".");
  controller.abort(false);
  await assert.rejects(session.run(null).next(), reason => reason === false);
  await session.close();
});
