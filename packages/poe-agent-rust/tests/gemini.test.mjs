import { test } from "node:test";
import assert from "node:assert/strict";
import * as rust from "../dist/index.js";
import * as typescript from "../../poe-agent/dist/index.js";

const collect = async (events) => {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
};
const response = (frames) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(
          frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("")
        );
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      }
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
const request = {
  messages: [{ role: "user", content: "Hello" }],
  tools: [],
  signal: new AbortController().signal
};

for (const [name, sdk] of [
  ["Rust", rust],
  ["TypeScript", typescript]
]) {
  test(`${name}: Gemini is available through SDK and plugin config`, () => {
    assert.equal(typeof sdk.geminiPlugin, "function");
    const [plugin] = sdk.resolvePluginsFromConfig([
      { name: "gemini", options: { apiKey: "test", reasoningEffort: "high" } }
    ]);
    assert.equal(plugin.providers[0].supports("gemini-4-argon"), true);
    assert.equal(plugin.providers[0].supports("google/gemini-4-argon"), true);
    assert.equal(plugin.providers[0].supports("gpt-6-astra"), false);
    assert.throws(() => sdk.geminiPlugin({ unexpected: true }), /unknown option/);
    assert.throws(() => sdk.geminiPlugin({ reasoningEffort: "invalid" }), /expected one of/);
  });

  test(`${name}: Gemini streams text, tools, signatures and thinking usage`, async () => {
    const calls = [];
    const part = {
      functionCall: { name: "bash", args: { command: "pwd" } },
      thoughtSignature: "opaque-signature"
    };
    const model = await sdk
      .geminiPlugin({
        baseUrl: "http://proxy.test/v1beta",
        apiKey: "test",
        reasoningEffort: "high"
      })
      .providers[0].createModel("gemini-4-argon", {
        options: {},
        fetch: async (url, init) => {
          calls.push({ url, init, body: JSON.parse(init.body) });
          return response([
            { candidates: [{ content: { parts: [{ text: "Consider", thought: true }] } }] },
            {
              candidates: [
                { content: { parts: [{ text: "Hello 🌍" }, part] }, finishReason: "STOP" }
              ]
            },
            {
              usageMetadata: {
                promptTokenCount: 100,
                candidatesTokenCount: 10,
                thoughtsTokenCount: 20,
                totalTokenCount: 130,
                cachedContentTokenCount: 40
              }
            }
          ]);
        }
      });
    const events = await collect(
      (
        await model.complete({
          ...request,
          tools: [
            {
              name: "bash",
              inputSchema: {
                type: "object",
                properties: { command: { type: "string" } },
                additionalProperties: false
              }
            }
          ]
        })
      ).events
    );
    assert.equal(
      calls[0].url,
      "http://proxy.test/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse"
    );
    assert.equal(calls[0].init.headers["x-goog-api-key"], "test");
    assert.equal(calls[0].init.signal, request.signal);
    assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, "HIGH");
    assert.equal(
      calls[0].body.tools[0].functionDeclarations[0].parametersJsonSchema.additionalProperties,
      false
    );
    assert.deepEqual(
      events.filter((e) => e.type === "text"),
      [{ type: "text", text: "Hello 🌍" }]
    );
    assert.deepEqual(
      events.find((e) => e.type === "usage"),
      {
        type: "usage",
        inputTokens: 100,
        outputTokens: 30,
        cachedTokens: 40,
        cacheCreationTokens: 0
      }
    );
    const tool = events.find((e) => e.type === "tool_use_complete");
    assert.equal(tool.name, "bash");
    assert.deepEqual(tool.args, { command: "pwd" });
    assert.deepEqual(events.at(-1), { type: "stop", reason: "tool_use" });
    const details = events.filter((e) => e.type === "reasoning_details").map((e) => e.payload);
    await collect(
      (
        await model.complete({
          ...request,
          messages: [
            { role: "system", content: "Be helpful." },
            ...request.messages,
            {
              role: "assistant",
              content: "Hello 🌍",
              reasoning_details: details,
              tool_calls: [
                {
                  id: tool.id,
                  type: "function",
                  function: { name: tool.name, arguments: JSON.stringify(tool.args) }
                }
              ]
            },
            {
              role: "tool",
              name: "bash",
              tool_call_id: tool.id,
              content: [
                { type: "text", text: "/workspace" },
                { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }
              ]
            }
          ]
        })
      ).events
    );
    const body = calls[1].body;
    assert.deepEqual(body.systemInstruction, { parts: [{ text: "Be helpful." }] });
    assert.deepEqual(body.contents[1].parts, [
      { text: "Consider", thought: true },
      { text: "Hello 🌍" },
      part
    ]);
    assert.equal(body.contents[2].parts[0].functionResponse.name, "bash");
    assert.deepEqual(body.contents[2].parts[1], {
      inlineData: { mimeType: "image/png", data: "aW1hZ2U=" }
    });
  });

  test(`${name}: Gemini fails on truncated, blocked and HTTP-error responses`, async () => {
    for (const [reply, expected] of [
      [
        () => response([{ candidates: [{ content: { parts: [{ text: "partial" }] } }] }]),
        /terminal/
      ],
      [() => response([{ promptFeedback: { blockReason: "SAFETY" } }]), /SAFETY/],
      [() => new Response('{"error":{"message":"unavailable"}}', { status: 503 }), /503/],
      [() => response([{ error: { message: "upstream failure" } }]), /upstream failure/]
    ]) {
      const model = await sdk
        .geminiPlugin({ apiKey: "test" })
        .providers[0].createModel("gemini-4-argon", { options: {}, fetch: async () => reply() });
      await assert.rejects(async () => collect((await model.complete(request)).events), expected);
    }
  });

  test(`${name}: Gemini does not inherit host credentials with custom filesystems`, async () => {
    const old = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "host-secret";
    try {
      await assert.rejects(
        async () =>
          sdk
            .geminiPlugin()
            .providers[0].createModel("gemini-4-argon", {
              runtime: { customFs: true },
              options: {},
              fetch
            }),
        /explicit apiKey/
      );
    } finally {
      if (old === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = old;
    }
  });
}
