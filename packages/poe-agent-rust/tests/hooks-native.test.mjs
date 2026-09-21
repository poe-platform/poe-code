import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/hooks.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/hooks.ts", import.meta.url);
const events = [
  "sessionStart",
  "userPromptSubmit",
  "preToolUse",
  "postToolUse",
  "preIteration",
  "postIteration",
  "preCompaction",
  "postCompaction",
  "notification",
  "stop",
  "unknown"
];
const outcome = async (api, event, decision) => {
  const ctx = { prompt: "original" };
  try {
    return { result: await api.applyHookDecision(event, decision, ctx), prompt: ctx.prompt };
  } catch (error) {
    return {
      name: error.name,
      message: error.message,
      cause: error.cause,
      ownCause: Object.hasOwn(error, "cause")
    };
  }
};
test("hook decision results, typed patches and malformed candidates match all events", async () => {
  const decisions = [
    undefined,
    null,
    false,
    0,
    "skip",
    "abort",
    "other",
    { block: true, reason: "blocked" },
    { block: 1, reason: "blocked" },
    { block: true, reason: 1 },
    { rewrite: { args: { x: 1 } } },
    { rewrite: Object.create({ args: null }) },
    { rewrite: null },
    { replace: { content: "x", details: { nested: true } } },
    { replace: null },
    { action: "transform", prompt: "new" },
    { action: "handled", response: { opaque: true } },
    { action: "unknown" },
    Object.assign([], { block: true, reason: "array" })
  ];
  for (const event of events)
    for (const decision of decisions)
      assert.deepEqual(
        await outcome(own, event, decision),
        await outcome(original, event, decision)
      );
});
test("decision getter order and changing candidates retain exact short circuit behavior", async () => {
  for (const scenario of ["reject", "block", "rewrite", "replace", "input"]) {
    const observations = [];
    for (const api of [original, own]) {
      const trace = [];
      let rewrites = 0,
        actions = 0;
      const decision = {
        get reject() {
          trace.push("reject");
          return scenario === "reject" ? "denied" : undefined;
        },
        get block() {
          trace.push("block");
          return scenario === "block";
        },
        get reason() {
          trace.push("reason");
          return "blocked";
        },
        get rewrite() {
          trace.push("rewrite");
          rewrites++;
          return scenario === "rewrite"
            ? {
                get args() {
                  trace.push("args");
                  return rewrites;
                }
              }
            : undefined;
        },
        get replace() {
          trace.push("replace");
          return scenario === "replace" ? { content: "patch" } : undefined;
        },
        get action() {
          trace.push("action");
          actions++;
          return scenario === "input" ? (actions === 1 ? "transform" : "handled") : undefined;
        },
        get response() {
          trace.push("response");
          return "handled";
        }
      };
      const warn = console.warn;
      console.warn = () => {};
      try {
        const event =
          scenario === "replace"
            ? "postToolUse"
            : scenario === "input"
              ? "userPromptSubmit"
              : "preToolUse";
        observations.push({ result: await outcome(api, event, decision), trace });
      } finally {
        console.warn = warn;
      }
    }
    assert.deepEqual(observations[1], observations[0]);
  }
});
test("hook pipelines use live registration order and continue after the first decision", async () => {
  for (const api of [original, own]) {
    const registry = new api.HookRegistry(),
      trace = [],
      ctx = {};
    registry.add({
      name: "one",
      hooks: {
        preToolUse: async (context) => {
          assert.equal(context, ctx);
          trace.push(1);
          registry.add({
            name: "late",
            hooks: {
              preToolUse: () => {
                trace.push(3);
                return "abort";
              }
            }
          });
          return null;
        }
      }
    });
    registry.add({
      name: "two",
      hooks: {
        preToolUse: () => {
          trace.push(2);
          return "skip";
        }
      }
    });
    assert.equal(await registry.run("preToolUse", ctx), null);
    assert.deepEqual(trace, [1, 2, 3]);
    assert.equal(await registry.run("unknown", ctx), undefined);
    const copy = new api.HookRegistry();
    copy.copyFrom(registry);
    assert.equal(await copy.run("preToolUse", ctx), null);
    const self = new api.HookRegistry();
    let calls = 0;
    self.add({ name: "self", hooks: { stop: () => calls++ } });
    self.copyFrom(self);
    await self.run("stop", ctx);
    assert.equal(calls, 2);
  }
});
test("abort disposes the attached context and preserves arbitrary disposal causes", async () => {
  for (const cause of [undefined, null, false, 0, "", Symbol("dispose")])
    for (const api of [original, own]) {
      let disposals = 0;
      const ctx = api.createSessionStartHookContext({
        session: new Map(),
        messages: [],
        signal: new AbortController().signal,
        disposeRun: async () => {
          disposals++;
          throw cause;
        }
      });
      const error = await api
        .applyHookDecision("sessionStart", "abort", ctx)
        .catch((error) => error);
      assert.ok(error instanceof api.AbortError);
      assert.equal(error.message, "Run aborted by sessionStart hook decision.");
      assert.equal(error.cause, cause);
      assert.equal(Object.hasOwn(error, "cause"), cause !== undefined);
      assert.equal(disposals, 1);
    }
});
