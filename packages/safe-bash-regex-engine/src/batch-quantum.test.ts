import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoundedRegexProvider } from "./execution/bounded-provider.js";
import { defaults, type Reply } from "./execution/protocol.js";

test("ASCII row batches yield multiple host turns with frozen clocks", async context => {
  context.mock.method(performance, "now", () => 0);
  context.mock.method(Date, "now", () => 0);
  const worker = createBoundedRegexProvider().createWorker(defaults);
  context.after(() => worker.terminate());
  let turns = 0;
  let host = setImmediate(function observe() { turns++; host = setImmediate(observe); });
  context.after(() => clearImmediate(host));
  const reply = new Promise<Reply>(resolve => worker.on("message", value => { if ((value as Reply).id === 1) resolve(value as Reply); }));
  worker.postMessage({ id: 1, descriptor: { kind: "rg", patterns: ["^ab$"], fixed: false, case: "sensitive", whole: false, word: false, nullData: false },
    rows: Array.from({ length: 2000 }, () => ({ bytes: new TextEncoder().encode("a".repeat(40) + "b"), all: false, terminated: true })) });
  const result = await reply;
  assert.ok("results" in result, JSON.stringify(result));
  assert.equal(result.results.length, 2000);
  assert.ok(turns >= 2, `observed ${turns} host turns`);
});
