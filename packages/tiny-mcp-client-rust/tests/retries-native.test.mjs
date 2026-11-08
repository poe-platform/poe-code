import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import * as native from "../dist/index.js";
import * as reference from "tiny-mcp-client";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {
    roots: {},
    elicitation: { form: {} },
    sampling: {}
  }
};
function setup(factory, respond) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames = [];
  const layer = new factory.JsonRpcMessageLayer(input, output, 30000, undefined, 1);
  layer.requestMetadata = structuredClone(metadata);
  output.on("data", (chunk) => {
    const frame = JSON.parse(String(chunk));
    frames.push(frame);
    const result = respond(frame, frames.length);
    if (result !== undefined)
      input.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }) + "\n");
  });
  return {
    layer,
    frames,
    input,
    close() {
      layer.dispose();
      input.destroy();
      output.destroy();
    }
  };
}

test("modern input-required retries invoke callbacks and retain original arguments with fresh IDs", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, (_frame, round) =>
      round === 1
        ? {
            resultType: "input_required",
            requestState: "opaque",
            inputRequests: {
              roots: { method: "roots/list" },
              form: {
                method: "elicitation/create",
                params: {
                  message: "name?",
                  requestedSchema: { type: "object", properties: { name: { type: "string" } } }
                }
              }
            }
          }
        : { resultType: "complete", content: [{ type: "text", text: "done" }] }
    );
    const contexts = [];
    state.layer.onInputRequest("roots/list", (_params, context) => {
      contexts.push(context);
      return { roots: [] };
    });
    state.layer.onInputRequest("elicitation/create", (_params, context) => {
      contexts.push(context);
      return { action: "accept", content: { name: "Ada" } };
    });
    const args = {
      name: "test",
      arguments: { count: 7 },
      requestState: "stale",
      inputResponses: { old: {} },
      _meta: { caller: true }
    };
    try {
      const response = await state.layer.sendRequest("tools/call", args);
      assert.equal(response.resultType, "complete");
      assert.equal(state.frames.length, 2);
      assert.deepEqual(
        state.frames.map((frame) => frame.id),
        [1, 2]
      );
      assert.deepEqual(state.frames[1].params.arguments, { count: 7 });
      assert.equal(state.frames[1].params.requestState, "opaque");
      assert.deepEqual(state.frames[1].params.inputResponses, {
        roots: { roots: [] },
        form: { action: "accept", content: { name: "Ada" } }
      });
      assert.equal(state.frames[1].params._meta.caller, true);
      assert.deepEqual(
        contexts.map((context) => [context.id, context.method]),
        [
          ["roots", "roots/list"],
          ["form", "elicitation/create"]
        ]
      );
      assert.equal(args.requestState, "stale");
    } finally {
      state.close();
    }
  }
});

test("modern result and cache validation rejects malformed results before accepting them", async () => {
  for (const factory of [native, reference])
    for (const [method, result, message] of [
      ["ping", {}, "Invalid modern resultType"],
      ["tools/call", { resultType: "complete", content: "bad" }, "Invalid tools/call result"],
      [
        "tools/list",
        { resultType: "complete", tools: [] },
        "MCP cache ttlMs must be a nonnegative safe integer"
      ],
      [
        "tools/list",
        { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "bad" },
        "MCP cacheScope must be public or private"
      ],
      ["tools/call", { resultType: "input_required" }, "Invalid MCP input_required result"]
    ]) {
      const state = setup(factory, () => result);
      try {
        await assert.rejects(state.layer.sendRequest(method, {}), { code: -32600, message });
      } finally {
        state.close();
      }
    }
});

test("unsupported input callbacks and invalid input responses do not send another request", async () => {
  for (const factory of [native, reference])
    for (const registered of [false, true]) {
      const state = setup(factory, () => ({
        resultType: "input_required",
        inputRequests: { roots: { method: "roots/list" } }
      }));
      if (registered)
        state.layer.onInputRequest("roots/list", () => ({
          roots: [{ uri: "https://wrong.test" }]
        }));
      try {
        await assert.rejects(state.layer.sendRequest("tools/call", {}), {
          code: registered ? -32600 : -32021,
          message: registered ? "Invalid MCP input response" : "Unsupported MCP input request"
        });
        assert.equal(state.frames.length, 1);
      } finally {
        state.close();
      }
    }
});

test("input callbacks retain exchange capacity and cancellation releases the caller without a retry", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, (frame) =>
      frame.method === "tools/call"
        ? { resultType: "input_required", inputRequests: { roots: { method: "roots/list" } } }
        : { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private" }
    );
    let release;
    let entered;
    let signal;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    state.layer.onInputRequest("roots/list", (_params, context) => {
      signal = context.signal;
      entered();
      return gate;
    });
    const controller = new AbortController();
    const pending = state.layer.sendRequest(
      "tools/call",
      {},
      { signal: controller.signal, timeoutMs: null }
    );
    try {
      await started;
      assert.throws(() => state.layer.sendRequest("tools/list", {}), {
        message: "JSON-RPC request capacity exceeded"
      });
      const reason = new Error("stop waiting");
      controller.abort(reason);
      await assert.rejects(pending, (error) => error === reason);
      assert.equal(signal.aborted, true);
      assert.deepEqual((await state.layer.sendRequest("tools/list", {})).tools, []);
      release({ roots: [] });
      await setImmediate();
      assert.equal(state.frames.length, 2);
    } finally {
      controller.abort();
      release({ roots: [] });
      await pending.catch(() => {});
      state.close();
    }
  }
});

test("retry round and input-request limits are enforced before additional callbacks or requests", async () => {
  for (const factory of [native, reference]) {
    const rounds = setup(factory, () => ({ resultType: "input_required", requestState: "again" }));
    try {
      await assert.rejects(rounds.layer.sendRequest("tools/call", {}), {
        code: -32600,
        message: "MCP input round limit exceeded"
      });
      assert.equal(rounds.frames.length, 65);
    } finally {
      rounds.close();
    }
    const limit = setup(factory, () => ({
      resultType: "input_required",
      inputRequests: Object.fromEntries(
        Array.from({ length: 65 }, (_, key) => [String(key), { method: "roots/list" }])
      )
    }));
    let calls = 0;
    limit.layer.onInputRequest("roots/list", () => {
      calls++;
      return { roots: [] };
    });
    try {
      await assert.rejects(limit.layer.sendRequest("tools/call", {}), {
        code: -32600,
        message: "MCP input request limit exceeded"
      });
      assert.equal(calls, 0);
    } finally {
      limit.close();
    }
  }
});

test("pre-aborted modern requests do not allocate IDs, invoke ID hooks or write frames", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, () => ({ resultType: "complete", content: [] }));
    const controller = new AbortController();
    const reason = new Error("already stopped");
    controller.abort(reason);
    let ids = 0;
    try {
      await assert.rejects(
        state.layer.sendRequest(
          "tools/call",
          {},
          {
            signal: controller.signal,
            onRequestId() {
              ids++;
            }
          }
        ),
        (error) => error === reason
      );
      assert.equal(ids, 0);
      assert.equal(state.frames.length, 0);
      await state.layer.sendRequest("tools/call", {});
      assert.equal(state.frames[0].id, 1);
    } finally {
      state.close();
    }
  }
});

test("sampling retries preserve argument snapshots and validate callback responses", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, (_frame, round) =>
      round === 1
        ? {
            resultType: "input_required",
            inputRequests: {
              sample: {
                method: "sampling/createMessage",
                params: {
                  messages: [{ role: "user", content: { type: "text", text: "sample" } }],
                  maxTokens: 10
                }
              }
            }
          }
        : { resultType: "complete", content: [] }
    );
    const args = {
      name: "tool",
      arguments: { count: 7 },
      requestState: "stale",
      inputResponses: { stale: {} }
    };
    state.layer.onInputRequest("sampling/createMessage", (params) => {
      assert.equal(params.maxTokens, 10);
      args.arguments.count = 99;
      return { role: "assistant", model: "test", content: { type: "text", text: "reply" } };
    });
    try {
      await state.layer.sendRequest("tools/call", args);
      assert.deepEqual(state.frames[1].params.arguments, { count: 7 });
      assert.equal(Object.hasOwn(state.frames[1].params, "requestState"), false);
      assert.equal(state.frames[1].params.inputResponses.sample.model, "test");
    } finally {
      state.close();
    }
  }
});

test("missing sampling and elicitation subcapabilities aggregate before input callbacks run", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, () => ({
      resultType: "input_required",
      inputRequests: {
        sample: {
          method: "sampling/createMessage",
          params: { messages: [], maxTokens: 10, tools: [] }
        },
        url: {
          method: "elicitation/create",
          params: {
            mode: "url",
            message: "sign in",
            url: "https://example.test/session",
            elicitationId: "id"
          }
        }
      }
    }));
    let calls = 0;
    state.layer.onInputRequest("sampling/createMessage", () => {
      calls++;
    });
    state.layer.onInputRequest("elicitation/create", () => {
      calls++;
    });
    try {
      const error = await state.layer.sendRequest("tools/call", {}).catch((error) => error);
      assert.equal(error.code, -32021);
      assert.deepEqual(error.data, {
        requiredCapabilities: { sampling: { tools: {} }, elicitation: { url: {} } }
      });
      assert.equal(calls, 0);
    } finally {
      state.close();
    }
  }
});
