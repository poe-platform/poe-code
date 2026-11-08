import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
import * as original from "../../poe-agent/dist/runtime/tools.js";
test("tool snapshots preserve host identity, receivers, streaming invocation and arbitrary failures", async () => {
  for (const api of [original, own]) {
    const registry = new api.ToolRegistry(),
      schema = { cyclic: true },
      policy = { opaque: true };
    schema.self = schema;
    let calls = 0;
    const tool = {
      name: "read",
      inputSchema: schema,
      policy,
      call(args, ctx) {
        assert.equal(this, tool);
        calls++;
        return { args, ctx };
      }
    };
    registry.register(tool);
    const normalized = registry.get(" read ");
    assert.equal(normalized.inputSchema, schema);
    assert.equal(normalized.policy, policy);
    assert.equal(Object.isFrozen(normalized), true);
    tool.call = () => {
      throw Error("should use bound snapshot");
    };
    const args = {},
      ctx = {};
    assert.deepEqual(await normalized.invoke(args, ctx).next(), {
      done: true,
      value: { args, ctx }
    });
    assert.equal(calls, 1);
    for (const reason of [undefined, null, false, 0, "", 0n]) {
      const invocation = api
        .normalizeTool({
          name: "fail",
          call() {
            throw reason;
          }
        })
        .invoke(args, ctx);
      await assert.rejects(invocation.next(), (value) => Object.is(value, reason));
      const rejected = api
        .normalizeTool({
          name: "fail",
          call() {
            return Promise.reject(reason);
          }
        })
        .invoke(args, ctx);
      await assert.rejects(rejected.next(), (value) => Object.is(value, reason));
    }
    const stream = (async function* () {
      yield { type: "progress", message: "step" };
      return "done";
    })();
    const streaming = api.normalizeTool({
      name: "stream",
      call() {
        return stream;
      }
    });
    assert.equal(streaming.invoke(args, ctx), stream);
    assert.deepEqual(await stream.next(), {
      done: false,
      value: { type: "progress", message: "step" }
    });
    assert.deepEqual(await stream.next(), { done: true, value: "done" });
  }
});
test("catalog copies share tool snapshots and preserve replacement order", async () => {
  for (const api of [original, own]) {
    const left = new api.ToolRegistry(),
      right = new api.ToolRegistry();
    left.register({ name: "a", call: () => "old" });
    left.register({ name: "b", call: () => "b" });
    right.register({ name: "a", visibility: "skill", call: () => "new" });
    right.register({ name: "c", visibility: "internal", call: () => "c" });
    left.copyFrom(right);
    assert.deepEqual(
      left.getAll().map((tool) => tool.name),
      ["a", "b", "c"]
    );
    assert.equal(left.get("a"), right.get("a"));
    left.copyFrom(left);
    assert.equal(left.getAll().length, 3);
    assert.deepEqual(
      left.getActiveTools(["a"]).map((tool) => tool.name),
      ["a", "b"]
    );
    const selectors = ["a"];
    Object.defineProperty(selectors, 0, {
      get() {
        left.register({ name: "late", call: () => "late" });
        return "a";
      }
    });
    assert.deepEqual(
      left.getActiveTools(selectors).map((tool) => tool.name),
      ["a", "b", "late"]
    );
    assert.equal(
      await left
        .get("a")
        .invoke({}, {})
        .next()
        .then((value) => value.value),
      "new"
    );
  }
});
test("active tool selectors retain Unicode whitespace and namespace boundary behavior", () => {
  for (const api of [original, own]) {
    const registry = new api.ToolRegistry();
    for (const name of ["repo_read", "repo2_read", "repo", "audit"])
      registry.register({
        name,
        visibility: name === "audit" ? "internal" : "skill",
        call: () => "ok"
      });
    assert.deepEqual(
      registry.getActiveTools(["\ufeffrepo.*\u00a0", "repo.*", "audit"]).map((tool) => tool.name),
      ["repo_read"]
    );
    assert.deepEqual(
      registry.getActiveTools(["repo"]).map((tool) => tool.name),
      ["repo_read", "repo"]
    );
    assert.deepEqual(
      registry.getActiveTools([".*", ""]).map((tool) => tool.name),
      []
    );
  }
});
