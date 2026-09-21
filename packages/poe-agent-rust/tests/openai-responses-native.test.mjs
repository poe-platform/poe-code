import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openaiResponsesPlugin as ownPlugin } from "../dist/plugin-openai-responses.js";
import { openaiResponsesPlugin as referencePlugin } from "../../poe-agent/dist/plugins/poe-agent-plugin-openai-responses.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
const encoder = new TextEncoder();
const collect = async (stream) => {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
};

test("seeded official SDK Responses streams agree on events and request bodies", async () => {
  for (let sample = 0; sample < 64; sample++) {
    const requests = [];
    const text = "hello 🌍\ud800" + sample;
    const message = {
      type: "message",
      id: "msg",
      role: "assistant",
      status: "in_progress",
      content: []
    };
    const call = {
      type: "function_call",
      id: "item",
      call_id: "call",
      name: "verbatim_tool.name",
      arguments: "",
      status: "in_progress"
    };
    const raw = sample % 3 ? '{"x":' + sample + "}" : "broken";
    const reasoning = { type: "reasoning", id: "reason", summary: [], encrypted_content: "opaque" };
    const response = {
      id: "resp",
      object: "response",
      status: "in_progress",
      output: [],
      output_text: "",
      usage: null,
      error: null,
      incomplete_details: null
    };
    const terminal = ["response.completed", "response.incomplete", "response.failed"][sample % 3];
    const final = {
      ...response,
      status: ["completed", "incomplete", "failed"][sample % 3],
      output: [
        {
          ...message,
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }]
        },
        { ...call, arguments: raw, status: "completed" },
        { ...reasoning, summary: [{ type: "summary_text", text: "thought" }] }
      ],
      usage: { input_tokens: 3, output_tokens: 2, input_tokens_details: { cached_tokens: 1 } },
      incomplete_details:
        terminal === "response.incomplete" ? { reason: "max_output_tokens" } : null
    };
    const frames = [
      { type: "response.created", response },
      { type: "response.output_item.added", output_index: 0, item: message },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] }
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        item_id: "msg",
        delta: text
      },
      { type: "response.output_item.added", output_index: 1, item: call },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "item",
        delta: raw.slice(0, 3)
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "item",
        delta: raw.slice(3)
      },
      {
        type: "response.output_item.done",
        output_index: 1,
        item: { ...call, arguments: raw, status: "completed" }
      },
      { type: "response.output_item.added", output_index: 2, item: reasoning },
      {
        type: "response.reasoning_summary_part.added",
        output_index: 2,
        summary_index: 0,
        part: { type: "summary_text", text: "" }
      },
      {
        type: "response.reasoning_summary_text.delta",
        output_index: 2,
        summary_index: 0,
        delta: "thought"
      },
      {
        type: "response.output_item.done",
        output_index: 2,
        item: { ...reasoning, summary: [{ type: "summary_text", text: "thought" }] }
      },
      { type: terminal, response: final }
    ].map((frame, sequence_number) => ({ ...frame, sequence_number }));
    const bytes = encoder.encode(
      frames
        .map((frame) => "event: " + frame.type + "\ndata: " + JSON.stringify(frame) + "\n\n")
        .join("")
    );
    const fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      const split = sample % bytes.length;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, split));
            controller.enqueue(bytes.slice(split));
            controller.close();
          }
        })
      );
    };
    const options = {
      apiKey: "test",
      baseUrl: "https://example.test/v1",
      project: "project",
      maxRetries: 0,
      reasoningEffort: "low",
      reasoningSummary: "concise"
    };
    const request = {
      messages: [
        {
          role: "user",
          content: [
            { type: "image", mimeType: "image/png", data: "ABC" },
            { type: "text", text: "hello" }
          ]
        },
        {
          role: "assistant",
          content: "",
          reasoning_details: [
            { type: "reasoning", id: "prior", encrypted_content: "old", summary: [] }
          ],
          tool_calls: [{ id: "past", function: { name: "verbatim_tool.name", arguments: "{}" } }]
        },
        { role: "tool", tool_call_id: " past ", content: "done" }
      ],
      tools: [{ name: "verbatim_tool.name", inputSchema: { properties: {}, required: [] } }],
      signal: new AbortController().signal
    };
    const run = async (factory) => {
      const model = await factory(options).providers[0].createModel("gpt-test", { fetch });
      return collect((await model.complete(request)).events);
    };
    assert.deepEqual(await run(ownPlugin), await run(referencePlugin));
    assert.deepEqual(requests[0], requests[1]);
  }
});

test("reasoning projection leaves opaque payloads untouched and stops batch scanning at termination", () => {
  const state = new native.NativeAgentResponsesStream();
  const item = { type: "reasoning" };
  Object.defineProperty(item, "opaque", {
    enumerable: true,
    get() {
      throw new Error("unreachable");
    }
  });
  const late = {
    get type() {
      throw new Error("late");
    }
  };
  assert.deepEqual(
    state.pushBatch([
      { type: "response.output_item.done", item },
      { type: "response.completed", response: {} },
      late
    ]),
    [
      { type: "reasoning_details", sourceIndex: 0 },
      { type: "pending_stop", reason: "end_turn" }
    ]
  );
});

test("late tool parse success updates the terminal stop within the same native batch", () => {
  const state = new native.NativeAgentResponsesStream();
  assert.deepEqual(
    state.pushBatch([
      {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call", name: "tool", arguments: "{}" }
      },
      { type: "response.completed", response: {} }
    ]),
    [
      { type: "pending_tool", id: "call", name: "tool", raw: "{}" },
      { type: "pending_stop", reason: "end_turn" }
    ]
  );
  state.recordToolSuccess();
  assert.equal(state.resolveStop("end_turn"), "tool_use");
  assert.equal(state.resolveStop("max_tokens"), "max_tokens");
});
