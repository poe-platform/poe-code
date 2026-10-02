import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

for (const name of ["trim", "ltrim", "rtrim"]) {
  for (const [input, expected] of [
    ["  hello world  ", name === "trim" ? "hello world" : name === "ltrim" ? "hello world  " : "  hello world"],
    ["", ""], [" \t\n\r\v\f", ""],
    ["\u00a0\u2003😀 a\u2028", name === "trim" ? "😀 a" : name === "ltrim" ? "😀 a\u2028" : "\u00a0\u2003😀 a"],
    ["\u200bhello\u200b", "\u200bhello\u200b"],
    ["hello world", "hello world"],
  ]) test(`${name} handles ${JSON.stringify(input)}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      session.compileOnce(name);
      const values = [];
      for await (const value of session.run(input!)) values.push(value);
      assert.deepEqual(values, [expected]);
    } finally { await session.close(); }
  });

  for (const input of [null, 42, [], {}]) test(`${name} rejects ${JSON.stringify(input)}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      session.compileOnce(name);
      await assert.rejects(session.run(input).next(), /requires a string/);
    } finally { await session.close(); }
  });

  test(`${name} accounts for scanned whitespace`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal, limits: { maxSteps: 100 } });
    try {
      session.compileOnce(name);
      await assert.rejects(session.run(" ".repeat(1000)).next(), /maxSteps/);
    } finally { await session.close(); }
  });
}
