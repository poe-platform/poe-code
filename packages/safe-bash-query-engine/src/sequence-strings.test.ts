import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonValues, parseJson } from "./input.js";
import { Budget, resolveJqLimits, type Json } from "./limits.js";

for (const [partial, detail, path] of [
  ['"partial', "Invalid numeric literal", []],
  ['"abc\\', "Invalid numeric literal", []],
  ['"tru', "Invalid literal", []],
  ['"true', undefined, []],
  ['"123', undefined, []],
  ['"', undefined, []],
  ['["partial', "Truncated value", [0]],
  ['{"a":"partial', "Truncated value", ["a"]],
] as const) {
  for (const streamErrors of [false, true]) {
    test(`streaming sequence interrupted string ${partial}, errors=${streamErrors}`, async () => {
      const bytes = Buffer.from(`\x1e${partial}\x1e{"ok":true}\n`);
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
        const message = `${detail} at line 1, column ${partial.length + 2}`;
        const expected = parseJson('[[["ok"],true],[["ok"]]]', budget) as Json[];
        if (detail && streamErrors) expected.unshift([message, [...path]]);
        assert.deepEqual(actual, expected);
        assert.deepEqual(warnings, detail && !streamErrors ? [`ignoring parse error: ${message}`] : []);
      }
    });
  }
}
