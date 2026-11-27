import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "./limits.js";
import { createYqQuerySession } from "./query-core.js";

const cases: [Json, Json][] = [
  [{ a: 1, b: 2 }, 3],
  [{}, null],
  [{ a: "hello", b: " world" }, "hello world"],
  [{ a: [1], b: [2, 3] }, [1, 2, 3]],
  [{ a: { x: 1 }, b: { x: 2, y: 3 } }, { x: 2, y: 3 }],
  [{ a: null, b: 2, c: null }, 2],
  [[], null],
  [[1, 2, 3], 6],
  [["a", "b"], "ab"],
];
for (const [input, expected] of cases) {
  test(`add reduces values of ${JSON.stringify(input)}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      session.compileOnce("add");
      const values = [];
      for await (const value of session.run(input)) values.push(value);
      assert.deepEqual(values, [expected]);
    } finally { await session.close(); }
  });
}

test("adding object values enforces the work budget", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal, limits: { maxSteps: 20 } });
  try {
    session.compileOnce("add");
    await assert.rejects(session.run(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]))).next(), /maxSteps/);
  } finally { await session.close(); }
});
