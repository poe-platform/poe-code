import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlqBytes, type HtmlOptions } from "./index.js";
import { independentFixtures } from "./independent-fixtures.js";

const options: HtmlOptions = {
  signal: new AbortController().signal,
  limits: { inputBytes: 100000, decodedBytes: 200000, retainedBytes: 4000000,
    nodes: 10000, attributes: 10000, depth: 100, tokenBytes: 100000,
    work: 1000000, outputBytes: 100000 }
};
for (const [id, source, argv, expected] of independentFixtures) {
  test(`independent ${id}: whole and bytewise streams`, async () => {
    const bytes = new TextEncoder().encode(source);
    for (const size of [bytes.length, 1, 7]) {
      async function* input() {
        for (let offset = 0; offset < bytes.length; offset += size)
          yield bytes.slice(offset, offset + size);
      }
      const chunks: Uint8Array[] = [];
      for await (const chunk of htmlqBytes(input(), argv, options)) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), Buffer.from(expected), `${id}, chunk=${size}`);
    }
  });
}
test("independent invalid selectors never become empty successful queries", async () => {
  for (const selector of ['[', 'p >', ':not(:not(p))', ':is(p)', ':where(p)', ':has(p)', ':lang(en)', 'registered|p']) {
    async function* input() { yield new TextEncoder().encode('<p>X</p>'); }
    await assert.rejects(async () => {
      for await (const chunk of htmlqBytes(input(), [selector], options)) void chunk;
    }, { code: 'E_SELECTOR' }, selector);
  }
});
