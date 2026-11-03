import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiResponsesPlugin } from "../dist/plugin-openai-responses.js";
import { collectModelResponseEvents } from "../dist/model-stream.js";
import { runAcpCore } from "../dist/acp-core.js";
import { createRunContext } from "../dist/run-context.js";

function sse(frames, headers = {}) {
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
    headers: { "retry-after-ms": "1", ...headers }
  });
}
function tool(id, complete = true) {
  const item = { type: "function_call", id, call_id: id, name: "write", arguments: "" };
  return [
    { type: "response.output_item.added", output_index: 0, item },
    ...(complete ? [
      { type: "response.function_call_arguments.delta", item_id: id, delta: JSON.stringify({ id }) },
      { type: "response.output_item.done", item: { ...item, arguments: JSON.stringify({ id }) } }
    ] : [])
  ];
}
const finished = { type: "response.completed", response: { status: "completed" } };
const failure = { error: { code: "server_error", message: "transient" } };
const request = () => ({ messages: [], tools: [], signal: new AbortController().signal });
async function model(fetch, maxRetries = 2) {
  return openaiResponsesPlugin({ apiKey: "test", maxRetries }).providers[0].createModel("gpt-test", { fetch });
}

for (const completed of [false, true]) {
  test(`failed stream ${completed ? "after completed tool" : "before arguments"} is discarded without replaying committed effects`, async () => {
    const requests = [], effects = [], events = [];
    const provider = await model(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      switch (requests.length) {
        case 1: return sse([...tool("prior"), finished]);
        case 2: return sse([...tool("failed", completed), failure]);
        case 3: return sse([...tool("success"), finished]);
        default: return sse([{ type: "response.output_text.delta", delta: "done" }, finished]);
      }
    });
    const context = createRunContext();
    for await (const event of runAcpCore({
      prompt: "write", runContext: context, model: provider, maxIterations: 3,
      host: { async handle(intent) { effects.push(intent.args.id); return { status: "success", result: "written" }; } }
    })) events.push(event);
    assert.equal(events.at(-1).type, "session.complete");
    assert.deepEqual(effects, ["prior", "success"]);
    assert.deepEqual(requests[1], requests[2]);
    assert.equal(context.messages.filter((message) => message.role === "tool").length, 2);
    assert.deepEqual(context.messages.flatMap((message) => message.tool_calls ?? []).map((call) => call.id), ["prior", "success"]);
    assert.equal(events.filter((event) => event.type === "model.attempt.failed").length, 1);
    assert.equal(events.filter((event) => event.type === "tool.result").length, 2);
  });
}

test("retry exhaustion and nonretryable errors preserve failure and never commit partial tools", async () => {
  for (const [code, retries, expected, headers] of [
    ["server_error", 2, 3, {}], ["server_error", 0, 1, {}],
    ["invalid_request_error", 2, 1, {}], ["server_error", 2, 1, { "x-should-retry": "false" }]
  ]) {
    let calls = 0;
    const provider = await model(async () => {
      calls++;
      return sse([...tool("failed"), { error: { code, message: "failed" } }], headers);
    }, retries);
    await assert.rejects(collectModelResponseEvents({ response: await provider.complete(request()) }), { code, message: "failed" });
    assert.equal(calls, expected);
  }
});

test("HTTP and streamed failures share the configured retry budget", async () => {
  let calls = 0;
  const provider = await model(async () => {
    calls++;
    if (calls === 1) return new Response("busy", { status: 503, headers: { "retry-after-ms": "1" } });
    return sse([failure]);
  });
  await assert.rejects(collectModelResponseEvents({ response: await provider.complete(request()) }), { code: "server_error" });
  assert.equal(calls, 3);
});

test("nonretryable HTTP errors are not retried as streamed failures", async () => {
  let calls = 0;
  const provider = await model(async () => {
    calls++;
    return new Response(JSON.stringify(failure), { status: 400 });
  });
  await assert.rejects(collectModelResponseEvents({ response: await provider.complete(request()) }), { status: 400 });
  assert.equal(calls, 1);
});

for (const error of [
  { type: "error", code: "server_error", message: "transient" },
  { error: { type: "rate_limit_exceeded", message: "busy" } }
]) {
  test(`recovers streamed ${error.code ?? error.error.type}`, async () => {
    let calls = 0;
    const provider = await model(async () => sse(++calls === 1 ? [error] : [
      { type: "response.output_text.delta", delta: "done" }, finished
    ]));
    const result = await collectModelResponseEvents({ response: await provider.complete(request()) });
    assert.equal(result.content, "done");
    assert.equal(calls, 2);
  });
}

test("cancellation during backoff prevents another request", async () => {
  const controller = new AbortController(), reason = new Error("canceled");
  let calls = 0;
  const provider = await model(async () => { calls++; return sse([failure], { "retry-after-ms": "10000" }); });
  await assert.rejects(collectModelResponseEvents({
    response: await provider.complete({ ...request(), signal: controller.signal }),
    emit(event) {
      if (event.type === "model.attempt.failed") setImmediate(() => controller.abort(reason));
    }
  }), (error) => error === reason);
  assert.equal(calls, 1);
});

test("failed response usage is attributed once and successful output has a fresh collector", async () => {
  let calls = 0;
  const events = [];
  const provider = await model(async () => sse(++calls === 1 ? [
    { type: "response.output_text.delta", delta: "discard" },
    { type: "response.failed", response: { status: "failed", error: failure.error, usage: { input_tokens: 7, output_tokens: 2 } } }
  ] : [{ type: "response.output_text.delta", delta: "keep" }, finished]));
  const result = await collectModelResponseEvents({ response: await provider.complete(request()), emit: (event) => events.push(event) });
  assert.equal(result.content, "keep");
  assert.equal(result.usage, undefined);
  assert.deepEqual(events.filter((event) => event.type === "usage"), [{
    type: "usage", attempt: 1, usage: { inputTokens: 7, outputTokens: 2, cachedTokens: 0, cacheCreationTokens: 0 }
  }]);
  assert.deepEqual(events.filter((event) => event.type === "model.attempt.start").map((event) => event.attempt), [1, 2]);
});
