import { test } from "node:test";
import assert from "node:assert/strict";
import { createTranscriptWriter, mapAcpEventToSessionUpdates } from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/transcript.ts", import.meta.url);
test("transcript updates preserve repeated getters, opaque values and arbitrary failures", () => {
  for (const api of [original, { mapAcpEventToSessionUpdates }]) {
    let types = 0, identifiers = 0;
    const payload = {}; payload.self = payload;
    const event = { get type() { types++; return "tool.intent"; }, get intentId() { return ++identifiers; }, tool: "shell", args: payload };
    const result = api.mapAcpEventToSessionUpdates(event);
    assert.equal(result[0].rawInput, payload);
    assert.equal(types, 2);
    assert.deepEqual(result.map(update => update.toolCallId), [1, 2]);
    let contents = 0;
    const message = { type: "message.delta", get content() { return ++contents === 1 ? "probe" : payload; } };
    assert.equal(api.mapAcpEventToSessionUpdates(message)[0].content.text, payload);
    const cause = {};
    assert.throws(() => api.mapAcpEventToSessionUpdates({ get type() { throw cause; } }), error => error === cause);
    for (const inputTokens of [0, -1, Infinity, NaN, "5", { valueOf: () => 5 }]) {
      const usage = { inputTokens, outputTokens: undefined, cachedTokens: 2, cacheCreationTokens: null };
      const result = api.mapAcpEventToSessionUpdates({ type: "usage", usage })[0];
      assert.equal(result.used, Math.max(0, inputTokens - 2));
      assert.equal(result.size, inputTokens);
      assert.equal(result._meta.inputTokens, inputTokens);
    }
    assert.equal(Object.is(api.mapAcpEventToSessionUpdates({ type: "usage", usage: { inputTokens: -0, cachedTokens: 0 } })[0].used, 0), true);
    const effects = [], usage = { inputTokens: { valueOf() { effects.push("left"); return 3n; } }, cachedTokens: { valueOf() { effects.push("right"); return 1n; } } };
    assert.throws(() => api.mapAcpEventToSessionUpdates({ type: "usage", usage }), TypeError);
    assert.deepEqual(effects, ["left", "right"]);
  }
});
test("transcript serialization occurs after path admission and retains retry/close behavior", async () => {
  const calls = [], cause = {}, writer = createTranscriptWriter({ logPath: "/logs/run.jsonl", fs: {
    async lstat(path) { calls.push(["stat", path]); const error = new Error(); error.code = "ENOENT"; throw error; },
    async mkdir(path) { calls.push(["mkdir", path]); },
    async appendFile(path, payload) { calls.push(["append", path, payload]); }
  } });
  await assert.rejects(writer.write({ type: "tool.result", intentId: "t", result: { toJSON() { throw cause; } } }), error => error === cause);
  assert.equal(calls.filter(([kind]) => kind === "append").length, 0);
  await writer.close();
  await writer.write({ type: "message.delta", content: "after" });
  assert.equal(calls.filter(([kind]) => kind === "mkdir").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "append").length, 1);
});
