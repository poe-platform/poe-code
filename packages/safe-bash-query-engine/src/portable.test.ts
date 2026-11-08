import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

test("queries compile, account UTF-8, and encode/decode without a Buffer global", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
  const session = createYqQuerySession({ signal: new AbortController().signal });
  try {
    session.compileOnce(".foo | @base64 | @base64d");
    const values = [];
    for await (const value of session.run({ foo: "é🐈" })) values.push(value);
    assert.deepEqual(values, ["é🐈"]);
  } finally {
    await session.close();
    Object.defineProperty(globalThis, "Buffer", descriptor);
  }
});
