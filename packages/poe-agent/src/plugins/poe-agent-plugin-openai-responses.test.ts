import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectProviderEvents } from "../testing/model-response.js";

const storeGetMock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>());
const createSecretStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    store: {
      get: storeGetMock
    }
  }))
);
const openAiResponsesStreamMock = vi.hoisted(() => vi.fn());
const openAiConstructorMock = vi.hoisted(() =>
  vi.fn(function OpenAIMock() {
    return {
      responses: {
        stream: openAiResponsesStreamMock
      }
    };
  })
);

vi.mock("auth-store", () => ({
  createSecretStore: createSecretStoreMock
}));

vi.mock("openai", () => ({
  default: openAiConstructorMock,
  OpenAI: openAiConstructorMock
}));

import {
  openaiResponsesPlugin,
  spec as openaiResponsesSpec
} from "./poe-agent-plugin-openai-responses.js";

function createEventStream(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  };
}

describe("poe-agent-plugin-openai-responses", () => {
  const originalPoeBaseUrl = process.env.POE_BASE_URL;
  const originalOpenaiBaseUrl = process.env.OPENAI_BASE_URL;
  const originalPoeApiKey = process.env.POE_API_KEY;
  const originalOpenaiApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.POE_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.POE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    storeGetMock.mockReset();
    createSecretStoreMock.mockClear();
    openAiResponsesStreamMock.mockReset();
    openAiConstructorMock.mockClear();
  });

  afterEach(() => {
    if (originalPoeBaseUrl === undefined) delete process.env.POE_BASE_URL;
    else process.env.POE_BASE_URL = originalPoeBaseUrl;
    if (originalOpenaiBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalOpenaiBaseUrl;
    if (originalPoeApiKey === undefined) delete process.env.POE_API_KEY;
    else process.env.POE_API_KEY = originalPoeApiKey;
    if (originalOpenaiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenaiApiKey;
  });

  it("validates config options with its plugin spec", () => {
    expect(
      openaiResponsesSpec.parseOptions({
        baseUrl: "https://api.poe.com/v1",
        apiKey: "test-key",
        organization: "org_123",
        project: "proj_123",
        defaultHeaders: {
          "x-trace-id": "trace-1"
        },
        timeout: 12_000,
        maxRetries: 3,
        reasoningEffort: "medium",
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"]
      })
    ).toEqual({
      baseUrl: "https://api.poe.com/v1",
      apiKey: "test-key",
      organization: "org_123",
      project: "proj_123",
      defaultHeaders: {
        "x-trace-id": "trace-1"
      },
      timeout: 12_000,
      maxRetries: 3,
      reasoningEffort: "medium",
      reasoningSummary: "detailed",
      include: ["reasoning.encrypted_content"]
    });

    expect(() =>
      openaiResponsesSpec.parseOptions({
        include: [123]
      })
    ).toThrow();
  });

  it("uses POE_BASE_URL and ignores OPENAI_BASE_URL for Poe credentials", async () => {
    storeGetMock.mockResolvedValue("stored-key");
    process.env.POE_BASE_URL = "https://poe-proxy.example.com/v1";
    process.env.OPENAI_BASE_URL = "https://foreign.example.com/v1";

    await openaiResponsesPlugin().providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    expect(openAiConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "stored-key",
        baseURL: "https://poe-proxy.example.com/v1"
      })
    );
  });

  it("maps response.output_text.delta events into text events", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.output_text.delta",
          delta: "hel",
          output_index: 0,
          content_index: 0,
          item_id: "msg_1",
          sequence_number: 1
        },
        {
          type: "response.output_text.delta",
          delta: "lo",
          output_index: 0,
          content_index: 0,
          item_id: "msg_1",
          sequence_number: 2
        },
        {
          type: "response.completed",
          sequence_number: 3,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "hello",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed"
          }
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "text",
        text: "hel"
      },
      {
        type: "text",
        text: "lo"
      },
      {
        type: "stop",
        reason: "end_turn"
      }
    ]);
  });

  it("maps response.reasoning_summary_text.delta events into thinking events", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.reasoning_summary_text.delta",
          delta: "Need to",
          item_id: "rs_1",
          output_index: 0,
          summary_index: 0,
          sequence_number: 1
        },
        {
          type: "response.reasoning_summary_text.delta",
          delta: " inspect",
          item_id: "rs_1",
          output_index: 0,
          summary_index: 0,
          sequence_number: 2
        },
        {
          type: "response.completed",
          sequence_number: 3,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed"
          }
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "thinking",
        text: "Need to"
      },
      {
        type: "thinking",
        text: " inspect"
      },
      {
        type: "stop",
        reason: "end_turn"
      }
    ]);
  });

  it("passes reasoning items through response.output_item.done as reasoning_details", async () => {
    const reasoningItem = {
      id: "rs_1",
      type: "reasoning",
      status: "completed",
      summary: [{ type: "summary_text", text: "Need to inspect" }],
      encrypted_content: "enc_123"
    };

    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.output_item.done",
          item: reasoningItem,
          output_index: 0,
          sequence_number: 1
        },
        {
          type: "response.completed",
          sequence_number: 2,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [reasoningItem],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed"
          }
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "reasoning_details",
        payload: reasoningItem
      },
      {
        type: "stop",
        reason: "end_turn"
      }
    ]);
  });

  it("buffers tool arguments by tool call and emits tool_use_complete with parsed args", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.output_item.added",
          item: {
            id: "call_1",
            call_id: "call_1",
            name: "read_file",
            arguments: "",
            type: "function_call",
            status: "in_progress"
          },
          output_index: 0,
          sequence_number: 1
        },
        {
          type: "response.function_call_arguments.delta",
          delta: '{"path":"REA',
          item_id: "call_1",
          output_index: 0,
          sequence_number: 2
        },
        {
          type: "response.function_call_arguments.delta",
          delta: 'DME.md"}',
          item_id: "call_1",
          output_index: 0,
          sequence_number: 3
        },
        {
          type: "response.output_item.done",
          item: {
            id: "call_1",
            call_id: "call_1",
            name: "read_file",
            arguments: '{"path":"README.md"}',
            type: "function_call",
            status: "completed"
          },
          output_index: 0,
          sequence_number: 4
        },
        {
          type: "response.completed",
          sequence_number: 5,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed"
          }
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "tool_use_delta",
        id: "call_1",
        name: "read_file"
      },
      {
        type: "tool_use_delta",
        id: "call_1",
        argsDelta: '{"path":"REA'
      },
      {
        type: "tool_use_delta",
        id: "call_1",
        argsDelta: 'DME.md"}'
      },
      {
        type: "tool_use_complete",
        id: "call_1",
        name: "read_file",
        args: {
          path: "README.md"
        }
      },
      {
        type: "stop",
        reason: "tool_use"
      }
    ]);
  });

  it("parses tool arguments from response.output_item.done when no argument deltas were streamed", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.output_item.added",
          item: {
            id: "call_1",
            call_id: "call_1",
            name: "read_file",
            arguments: "",
            type: "function_call",
            status: "in_progress"
          },
          output_index: 0,
          sequence_number: 1
        },
        {
          type: "response.output_item.done",
          item: {
            id: "call_1",
            call_id: "call_1",
            name: "read_file",
            arguments: '{"path":"README.md"}',
            type: "function_call",
            status: "completed"
          },
          output_index: 0,
          sequence_number: 2
        },
        {
          type: "response.completed",
          sequence_number: 3,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed"
          }
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "tool_use_delta",
        id: "call_1",
        name: "read_file"
      },
      {
        type: "tool_use_complete",
        id: "call_1",
        name: "read_file",
        args: {
          path: "README.md"
        }
      },
      {
        type: "stop",
        reason: "tool_use"
      }
    ]);
  });

  it("emits tool_use_json_parse_error when completed tool arguments are invalid JSON", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.output_item.added",
          item: {
            id: "call_1",
            call_id: "call_1",
            name: "read_file",
            arguments: "",
            type: "function_call",
            status: "in_progress"
          },
          output_index: 0,
          sequence_number: 1
        },
        {
          type: "response.function_call_arguments.delta",
          delta: '{"path":README.md',
          item_id: "call_1",
          output_index: 0,
          sequence_number: 2
        },
        {
          type: "response.output_item.done",
          item: {
            id: "call_1",
            call_id: "call_1",
            name: "read_file",
            arguments: '{"path":README.md',
            type: "function_call",
            status: "completed"
          },
          output_index: 0,
          sequence_number: 3
        },
        {
          type: "response.completed",
          sequence_number: 4,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed"
          }
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "tool_use_delta",
        id: "call_1",
        name: "read_file"
      },
      {
        type: "tool_use_delta",
        id: "call_1",
        argsDelta: '{"path":README.md'
      },
      {
        type: "tool_use_json_parse_error",
        id: "call_1",
        raw: '{"path":README.md',
        error: expect.any(String)
      },
      {
        type: "stop",
        reason: "tool_use"
      }
    ]);
  });

  it("maps response.completed usage into a usage event", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.completed",
          sequence_number: 1,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "ok",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed",
            usage: {
              input_tokens: 1200,
              input_tokens_details: {
                cached_tokens: 800
              },
              output_tokens: 34,
              output_tokens_details: {
                reasoning_tokens: 50
              },
              total_tokens: 1234
            }
          }
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "usage",
        inputTokens: 1200,
        outputTokens: 34,
        cachedTokens: 800,
        cacheCreationTokens: 0
      },
      {
        type: "stop",
        reason: "end_turn"
      }
    ]);
  });

  it("propagates response.error events", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "error",
          code: "server_error",
          message: "upstream failed",
          param: null,
          sequence_number: 1
        }
      ])
    );

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    await expect(collectProviderEvents(response!)).rejects.toThrow("upstream failed");
  });

  it("defaults include to reasoning.encrypted_content and allows overriding include and reasoning", async () => {
    openAiResponsesStreamMock.mockReturnValue(
      createEventStream([
        {
          type: "response.completed",
          sequence_number: 1,
          response: {
            id: "resp_1",
            object: "response",
            created_at: 0,
            output_text: "ok",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-5.4",
            output: [],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            top_p: null,
            status: "completed"
          }
        }
      ])
    );

    const defaultPlugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const defaultModel = await defaultPlugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    await defaultModel?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(openAiResponsesStreamMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        include: ["reasoning.encrypted_content"]
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );

    const overridePlugin = openaiResponsesPlugin({
      apiKey: "test-key",
      include: ["message.output_text.logprobs"],
      reasoningEffort: "minimal",
      reasoningSummary: "detailed"
    });
    const overrideModel = await overridePlugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    await overrideModel?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(openAiResponsesStreamMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        include: ["message.output_text.logprobs"],
        reasoning: {
          effort: "minimal",
          summary: "detailed"
        }
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("does not serialize tool call ids as historical function call item ids", async () => {
    openAiResponsesStreamMock.mockReturnValue(createEventStream([]));

    const plugin = openaiResponsesPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    await model?.complete({
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_docajrA7yeAeaU8BuUJ6eMtW",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"README.md"}'
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_docajrA7yeAeaU8BuUJ6eMtW",
          content: "contents"
        }
      ],
      tools: [],
      signal: new AbortController().signal
    });

    expect(openAiResponsesStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          {
            call_id: "call_docajrA7yeAeaU8BuUJ6eMtW",
            type: "function_call",
            name: "read_file",
            arguments: '{"path":"README.md"}',
            status: "completed"
          },
          {
            type: "function_call_output",
            call_id: "call_docajrA7yeAeaU8BuUJ6eMtW",
            output: "contents"
          }
        ]
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });
});
