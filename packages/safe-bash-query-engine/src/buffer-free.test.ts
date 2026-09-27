import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, resolveJqLimits } from "./limits.js";
import { jsonValues, parseJson, rawValues, tryProcessFlatSelectProjectChunkSync } from "./input.js";
import { createYqQuerySession } from "./query-core.js";

test("queries parse and format Unicode without a Node Buffer global", async () => {
  const original = globalThis.Buffer;
  Reflect.deleteProperty(globalThis, "Buffer");
  try {
    for (const [query, input, expected] of [
      [".a + 1", { a: 2 }, "3"],
      ["@base64 | @base64d", "— 🌍 α 中文", '"— 🌍 α 中文"'],
      ['indices("α")', "α🌍α", "[0,6]"],
      ['gsub("x"; "🌍")', "x — α", '"🌍 — α"'],
      ["@base64d", "YQ=", '"a"'],
      ["@uri", "α", '"%CE%B1"'],
    ] as const) {
      const session = createYqQuerySession({ signal: new AbortController().signal, limits: { maxValueBytes: 4096 } });
      try {
        session.compileOnce(query);
        const results: string[] = [];
        for await (const value of session.run(input)) results.push(await session.ownedWork.stringifyJson(value, { pretty: false, maxBytes: 1000, limitName: "maxValueBytes" }));
        assert.deepEqual(results, [expected]);
      } finally { await session.close(); }
    }
  } finally { globalThis.Buffer = original; }
});

test("JSON and raw byte streams preserve Unicode and byte offsets without Buffer", async () => {
  const original = globalThis.Buffer;
  const bytes = new TextEncoder().encode('padding{"α":"🌍 — 中文"}\n');
  const originalBytes = bytes.subarray(7);
  Reflect.deleteProperty(globalThis, "Buffer");
  try {
    const budget = new Budget(resolveJqLimits(), new AbortController().signal);
    const expected = { α: "🌍 — 中文" };
    assert.deepEqual(parseJson('{"α":"🌍 — 中文"}', budget), expected);
    const source = { async *[Symbol.asyncIterator]() { yield originalBytes.subarray(0, 9); yield originalBytes.subarray(9); } };
    const values = [];
    for await (const value of jsonValues(source, budget)) values.push(value);
    assert.deepEqual(values, [expected]);
    const sources = { async *[Symbol.asyncIterator]() { yield source; } };
    const lines = [];
    for await (const line of rawValues(sources, budget, false)) lines.push(line);
    assert.deepEqual(lines, ['{"α":"🌍 — 中文"}']);
    assert.throws(() => parseJson('"α"', new Budget(resolveJqLimits({ maxValueBytes: 3 }), new AbortController().signal)), /maxValueBytes/);
  } finally { globalThis.Buffer = original; }
});

test("flat projection caches accept fresh Uint8Array chunks without Buffer methods", () => {
  const original = globalThis.Buffer;
  const chunk = new TextEncoder().encode('{"a":1,"b":2}\n'.repeat(64));
  Reflect.deleteProperty(globalThis, "Buffer");
  try {
    for (let iteration = 0; iteration < 2; iteration++) {
      const output = new Uint8Array(chunk.length);
      const budget = new Budget(resolveJqLimits(), new AbortController().signal);
      const length = tryProcessFlatSelectProjectChunkSync(new Uint8Array(chunk), budget, undefined, ["a"], ["a"], output);
      assert.ok(length > 0);
      assert.equal(new TextDecoder().decode(output.subarray(0, length)), '{"a":1}\n'.repeat(64));
    }
  } finally { globalThis.Buffer = original; }
});
