import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
import { openaiChatCompletionsPlugin as ownPlugin } from "../dist/plugin-openai-chat-completions.js";
import { openaiChatCompletionsPlugin as referencePlugin } from "../../poe-agent/dist/plugins/poe-agent-plugin-openai-chat-completions.js";

test("seeded end-to-end chat mappings and request bodies agree with the original provider", async () => {
  let seed = 0x20260728;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const encoder = new TextEncoder();
  const collect = async (stream) => {
    const result = [];
    for await (const event of stream) result.push(event);
    return result;
  };
  for (let sample = 0; sample < 128; sample++) {
    const requests = [],
      chunks = [];
    for (let n = 0; n < 12; n++) {
      const index = random() % 3;
      chunks.push({
        choices: [
          {
            delta: {
              content: ["", "hello🌍", "\ud800", null][random() % 4],
              tool_calls: [
                {
                  index,
                  ...(n < 3 ? { id: ` id-${index} ` } : {}),
                  function: {
                    ...(random() % 2 ? { name: `tools_workflow.${index}` } : {}),
                    arguments: ["", "{}", "[]", "broken", "null"][random() % 5]
                  }
                }
              ]
            },
            finish_reason: [null, "stop", "tool_calls", "length", "content_filter", false, 42][
              random() % 7
            ]
          }
        ],
        ...(random() % 3
          ? {}
          : {
              usage: {
                prompt_tokens: random() % 4,
                completion_tokens: 2.8,
                prompt_tokens_details: { cached_tokens: -1 },
                cache_read_input_tokens: 3,
                cache_creation_input_tokens: 1
              }
            })
      });
    }
    const options = { apiKey: " test ", baseUrl: "https://example.test/v1", maxRetries: 0 };
    const request = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "image", mimeType: "image/png", data: "ABC" }
          ]
        },
        {
          role: "assistant",
          content: "",
          thinking: [{ text: "a" }, { text: "b" }],
          reasoning: " explicit "
        },
        { role: "tool", name: "verbatim_tool.name", tool_call_id: "tool-1", content: "done" }
      ],
      tools: [
        {
          name: "verbatim_tool.name",
          inputSchema: { properties: { x: { type: "number" } }, required: ["x"] }
        }
      ],
      signal: new AbortController().signal
    };
    const fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(
        encoder.encode(
          chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") +
            "data: [DONE]\n\n"
        )
      );
    };
    const run = async (factory) => {
      const model = await factory(options).providers[0].createModel("model", { fetch });
      return collect((await model.complete(request)).events);
    };
    assert.deepEqual(await run(ownPlugin), await run(referencePlugin));
    assert.deepEqual(requests[0], requests[1]);
  }
});

test("native retained tool and index limits bound adversarial accumulation", () => {
  const state = new native.NativeAgentChatStream();
  for (let index = 0; index < 4096; index++)
    state.push({ choices: [{ delta: { tool_calls: [{ index, id: "shared" }] } }] });
  assert.throws(
    () => state.push({ choices: [{ delta: { tool_calls: [{ index: 4096, id: "shared" }] } }] }),
    /tool-index limit/
  );
  const bounded = new native.NativeAgentChatStream();
  const delta = "x".repeat(1048576);
  for (let n = 0; n < 7; n++)
    bounded.push({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { arguments: delta } }] } }]
    });
  assert.throws(
    () =>
      bounded.push({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: delta } }] } }]
      }),
    /retained UTF16 limit/
  );
});

test("stream projection ignores unused metadata and invalid usage numbers", () => {
  const state = new native.NativeAgentChatStream();
  const chunk = {
    choices: [{ delta: { content: "hello\ud800" } }],
    usage: {
      prompt_tokens: Infinity,
      completion_tokens: NaN,
      prompt_tokens_details: { cached_tokens: -1 },
      cache_read_input_tokens: 2
    }
  };
  Object.defineProperty(chunk, "unused", {
    enumerable: true,
    get() {
      throw new Error("unreachable");
    }
  });
  assert.deepEqual(state.push(chunk), [{ type: "text", text: "hello\ud800" }]);
  assert.deepEqual(state.finish(), [
    { type: "usage", inputTokens: 0, outputTokens: 0, cachedTokens: 2, cacheCreationTokens: 0 },
    { type: "stop", reason: "end_turn" }
  ]);
});
