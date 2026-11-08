import assert from "node:assert/strict";
import { test } from "node:test";
const own = await import("../dist/index.js"),
  original = await import("../../agent-spawn/dist/index.js");
function context(events = [], stream) {
  return {
    sessionId: "unknown",
    agent: "codex",
    events,
    usage: { inputTokens: 0, outputTokens: 0 },
    eventStream: stream
  };
}
async function collect(events) {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
}
test("session capture keeps cyclic tool inputs, getter receivers and stable tool aliases", async () => {
  class Start {
    #title = "Private receiver";
    event = "tool_start";
    id = "tool";
    kind = "exec";
    get title() {
      return this.#title;
    }
  }
  const input = { value: 1 };
  input.self = input;
  for (const api of [original, own]) {
    const start = Object.assign(new Start(), { input }),
      end = { event: "tool_complete", id: "tool", status: "failed", path: "result" };
    const ctx = context(
      [start],
      (async function* () {
        yield { event: "agent_message", text: "one" };
        yield end;
        yield { event: "agent_message", text: "two" };
      })()
    );
    await api.sessionCapture(ctx, async () => {});
    assert.equal(ctx.sessionResult.toolCalls[0].input, input);
    const alias = ctx.sessionResult.toolCalls[0],
      events = await collect(ctx.eventStream);
    assert.equal(ctx.sessionResult.toolCalls.length, 1);
    assert.equal(ctx.sessionResult.toolCalls[0], alias);
    assert.equal(alias.title, "Private receiver");
    assert.equal(alias.status, "failed");
    assert.equal(ctx.sessionResult.output, "one\ntwo");
    assert.equal(events[1], end);
    assert.equal(ctx.events[0], start);
  }
});
test("billing capture preserves seeded usage identity, infinite seeds and cancellation object", async () => {
  for (const api of [original, own]) {
    const usage = {
        inputTokens: Infinity,
        outputTokens: 10,
        cachedTokens: 0,
        extra: { opaque: true }
      },
      failure = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const ctx = context(
      [],
      (async function* () {
        yield { event: "usage", inputTokens: 5, outputTokens: 2, cachedTokens: NaN, costUsd: 0 };
        yield { event: "usage", inputTokens: -4, outputTokens: Infinity };
        throw failure;
      })()
    );
    ctx.usage = usage;
    await api.usageCapture(ctx, async () => {});
    await assert.rejects(
      () => collect(ctx.eventStream),
      (error) => error === failure
    );
    assert.equal(ctx.usage, usage);
    assert.deepEqual(usage, {
      inputTokens: Infinity,
      outputTokens: 12,
      cachedTokens: 0,
      costUsd: 0,
      extra: { opaque: true }
    });
    assert.deepEqual(failure.usage, usage);
    assert.notEqual(failure.usage, usage);
    assert.equal(failure.usage.extra, usage.extra);
    assert.equal(api.getCapturedUsage(usage), usage);
  }
});
test("billing capture de-duplicates repeated preloaded event identities and keeps zero presence", async () => {
  for (const api of [original, own]) {
    const event = { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 0, costUsd: 0 };
    const ctx = context(
      [event, event],
      (async function* () {
        yield event;
        yield event;
        yield event;
      })()
    );
    await api.usageCapture(ctx, async () => {});
    assert.equal((await collect(ctx.eventStream)).length, 3);
    assert.deepEqual(ctx.usage, { inputTokens: 3, outputTokens: 6, cachedTokens: 0, costUsd: 0 });
    const empty = context(
      [],
      (async function* () {
        for (let index = 0; index < 64; index++) yield { event: "agent_message", text: "private" };
        yield { event: "session_start", threadId: "metadata" };
      })()
    );
    await api.sessionMetadataCapture(empty, async () => {});
    await collect(empty.eventStream);
    assert.deepEqual(empty.events, []);
    assert.equal(empty.sessionResult, undefined);
    assert.equal(empty.threadId, "metadata");
  }
});
test("preloaded capture getters observe earlier host updates in event order", async () => {
  for (const api of [original, own]) {
    const ctx = context();
    ctx.events = [
      { event: "agent_message", text: "one" },
      {
        event: "agent_message",
        get text() {
          return ctx.sessionResult.output;
        }
      },
      { event: "session_start", threadId: "first" },
      {
        event: "session_start",
        get threadId() {
          return ctx.sessionId + "-second";
        }
      }
    ];
    await api.sessionCapture(ctx, async () => {});
    assert.equal(ctx.sessionResult.output, "one\none");
    assert.equal(ctx.threadId, "first-second");
  }
});
