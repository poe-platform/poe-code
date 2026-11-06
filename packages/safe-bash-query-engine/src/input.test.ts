import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonFragments, jsonValues, parseJson, renderJsonFragment, tryProcessFlatJsonChunkSync } from "./input.js";
import { Budget, objectKeys, objectSize, resolveJqLimits, type Json } from "./limits.js";

for (const input of ["\x1e1", "\x1e1\x1e2\n", "\x1e1\n\x1e2\n"]) {
  for (const streamErrors of [false, true]) {
    test(`streaming sequences preserve numeric records: ${JSON.stringify(input)}, errors=${streamErrors}`, async () => {
      const bytes = Buffer.from(input);
      for (const size of [1, bytes.length]) {
        const budget = new Budget(resolveJqLimits(), new AbortController().signal);
        const warnings: string[] = [];
        const actual: Json[] = [];
        const source = (async function* () {
          for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
        })();
        for await (const value of jsonValues(source, budget, {
          sequence: true, stream: true, streamErrors,
          async warning(message) { warnings.push(message); },
        })) actual.push(value);
        assert.deepEqual(actual, parseJson(input.includes("2") ? "[[[],1],[[],2]]" : "[[[],1]]", budget));
        assert.deepEqual(warnings, []);
      }
    });
  }
}

test("flat JSON parsing uses each invocation's value limit", () => {
  const bytes = new TextEncoder().encode('{"x":1}\n');
  for (const maxValueBytes of [100, 2, 100]) {
    const budget = new Budget(resolveJqLimits({ maxValueBytes }), new AbortController().signal);
    let values = 0;
    assert.equal(tryProcessFlatJsonChunkSync(bytes, budget, () => { values++; }), maxValueBytes === 100);
    assert.equal(values, maxValueBytes === 100 ? 1 : 0);
  }
});

for (const key of ["0", "12", "1abc", "__proto__"]) {
  for (const retainValues of [false, true]) {
    test(`flat JSONL preserves keys and clears stale fields: ${key}, retain=${retainValues}`, async () => {
      const budget = new Budget(resolveJqLimits(), new AbortController().signal);
      const lines = [
        `{"a":1,"${key}":2,"b":3}`,
        `{"a":10,"${key}":20,"b":30}`,
        '{"b":999}',
        `{"a":4,"${key}":5,"b":6}`,
        `{"a":7,"${key}":8}`,
        '{}',
        '{"c":9}',
      ];
      const results: string[] = [];
      const keys: string[][] = [];
      const sizes: number[] = [];
      const source = (async function* () { yield Buffer.from(lines.join("\n") + "\n"); })();
      for await (const unused of jsonValues(source, budget, {
        retainValues,
        onValue(value) {
          const obj = value as Record<string, Json>;
          results.push([...jsonFragments(value, budget)].map(fragment => renderJsonFragment(fragment, budget)).join(""));
          keys.push(objectKeys(obj));
          sizes.push(objectSize(obj));
        },
      })) { assert.fail(`unexpected yielded value: ${unused}`); }
      assert.deepEqual(results, lines);
      assert.deepEqual(keys, [["a", key, "b"], ["a", key, "b"], ["b"], ["a", key, "b"], ["a", key], [], ["c"]]);
      assert.deepEqual(sizes, [3, 3, 1, 3, 2, 0, 1]);
    });
  }
}
