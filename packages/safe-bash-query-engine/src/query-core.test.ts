import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

for (const [filter, input, expected] of [
  [".a = .b // 5", { b: null }, { b: null, a: null }],
  [".a |= . // 5", { a: null }, { a: null }],
  [".a += .b // 5", { a: 2, b: null }, { a: 2, b: null }],
  [".a = (.b // 5)", { b: null }, { b: null, a: 5 }],
  [".a |= (. // 5)", { a: null }, { a: 5 }],
] as const) {
  test(`assignment binds before alternative: ${filter}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    session.compileOnce(filter);
    try {
      const values = [];
      for await (const value of session.run(input)) {
        values.push(await session.ownedWork.stringifyJson(value, { pretty: false, maxBytes: 100, limitName: "maxValueBytes" }));
      }
      assert.deepEqual(values, [JSON.stringify(expected)]);
    } finally { await session.close(); }
  });
}

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

for (const filter of ['index("x")', 'rindex("x")']) {
  test(`${filter} preserves null input`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    session.compileOnce(filter);
    try {
      const values = [];
      for await (const value of session.run(null)) values.push(value);
      assert.deepEqual(values, [null]);
    } finally { await session.close(); }
  });
}
