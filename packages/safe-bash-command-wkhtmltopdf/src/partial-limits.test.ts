import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInvocation } from "./parser.js";
import { withResources } from "./resources.js";

test("omitted parse limits are unbounded while supplied limits remain enforced", () => {
  assert.equal(parseInvocation(["input.html", "output.pdf"], { limits: { maxObjects: 1 } }).objects.length, 1);
  assert.throws(() => parseInvocation(["a", "b", "out"], { limits: { maxObjects: 1 } }), { code: "LIMIT_EXCEEDED" });
});

test("omitted resource limits are unbounded while supplied limits remain enforced", async () => {
  await withResources({ limits: { maxResources: 1 }, signal: new AbortController().signal }, async resources => {
    assert.deepEqual(await resources.load("data:,abc"), Uint8Array.of(97, 98, 99));
    await assert.rejects(resources.load("data:,def"), { code: "LIMIT_EXCEEDED" });
  });
});
