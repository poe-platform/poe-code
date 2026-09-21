import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/prompts.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/prompts.ts", import.meta.url);
test("prompt pipelines preserve host context, sequential transforms and explicit user input", async () => {
  for (const api of [original, own]) {
    const registry = new api.PromptRegistry(),
      trace = [],
      opaque = () => {},
      key = Symbol("extension"),
      user = Symbol("user");
    registry.addTransform(async function (context) {
      assert.equal(this, undefined);
      trace.push([1, context.userPrompt, context.baseSystemPrompt, context.system]);
      await Promise.resolve();
      return { ...context, userPrompt: "changed", metadata: { opaque }, [key]: opaque };
    });
    registry.addTransform((context) => {
      trace.push([2, context.userPrompt]);
      assert.equal(context.metadata.opaque, opaque);
      assert.equal(context[key], opaque);
      return { ...context, system: "rewritten" };
    });
    const result = await registry.compile(user, null);
    assert.equal(result.userPrompt, user);
    assert.equal(result.system, "rewritten");
    assert.equal(result[key], opaque);
    assert.deepEqual(trace, [
      [1, user, null, null],
      [2, user]
    ]);
    for (const value of [undefined, null, false, Symbol("cause")]) {
      const failed = new api.PromptRegistry();
      failed.addTransform(() => {
        throw value;
      });
      await assert.rejects(failed.compile("x"), (error) => error === value);
    }
  }
});
test("prompt transforms added during compilation and registry copying keep live order", async () => {
  for (const api of [original, own]) {
    const registry = new api.PromptRegistry(),
      trace = [];
    let added = false;
    registry.addTransform((context) => {
      trace.push(1);
      if (!added) {
        added = true;
        registry.addTransform((ctx) => {
          trace.push(3);
          return ctx;
        });
      }
      return context;
    });
    registry.addTransform((context) => {
      trace.push(2);
      return context;
    });
    await registry.compile("x");
    assert.deepEqual(trace, [1, 2, 3]);
    const copy = new api.PromptRegistry();
    copy.copyFrom(registry);
    trace.length = 0;
    await copy.compile("x");
    assert.deepEqual(trace, [1, 2, 3]);
    const self = new api.PromptRegistry();
    let calls = 0;
    self.addTransform((context) => {
      calls++;
      return context;
    });
    self.copyFrom(self);
    await self.compile("x");
    assert.equal(calls, 2);
    const getters = new api.PromptRegistry(),
      reason = Symbol("getter");
    getters.addTransform(() => ({
      get userPrompt() {
        throw reason;
      }
    }));
    await assert.rejects(getters.compile("x"), (error) => error === reason);
  }
});
