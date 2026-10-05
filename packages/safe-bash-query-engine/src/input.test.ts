import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonFragments, jsonValues, renderJsonFragment } from "./input.js";
import { Budget, objectKeys, objectSize, resolveJqLimits, type Json } from "./limits.js";

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
