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
const openAiCreateMock = vi.hoisted(() => vi.fn());
const openAiConstructorMock = vi.hoisted(() =>
  vi.fn(function OpenAIMock() {
    return {
      chat: {
        completions: {
          create: openAiCreateMock
        }
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
  openaiChatCompletionsPlugin,
  spec as openaiChatCompletionsSpec
} from "./poe-agent-plugin-openai-chat-completions.js";

function createChunkStream(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  };
}

describe("poe-agent-plugin-openai-chat-completions", () => {
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
    openAiCreateMock.mockReset();
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
      openaiChatCompletionsSpec.parseOptions({
        baseUrl: "https://api.poe.com/v1",
        apiKey: "test-key",
        organization: "org_123",
        defaultHeaders: {
          "x-trace-id": "trace-1"
        },
        timeout: 12_000,
        maxRetries: 3
      })
    ).toEqual({
      baseUrl: "https://api.poe.com/v1",
      apiKey: "test-key",
      organization: "org_123",
      defaultHeaders: {
        "x-trace-id": "trace-1"
      },
      timeout: 12_000,
      maxRetries: 3
    });

    expect(() =>
      openaiChatCompletionsSpec.parseOptions({
        defaultHeaders: {
          authorization: 123
        }
      })
    ).toThrow();
  });

  it("maps streaming delta.content chunks into text events", async () => {
    openAiCreateMock.mockResolvedValue(
      createChunkStream([
        {
          choices: [
            {
              delta: {
                content: "hel"
              },
              finish_reason: null,
              index: 0
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                content: "lo"
              },
              finish_reason: "stop",
              index: 0
            }
          ]
        }
      ])
    );

    const plugin = openaiChatCompletionsPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        stream: true,
        stream_options: {
          include_usage: true
        }
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
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

  it("buffers tool arguments deltas and emits tool_use_complete with parsed args", async () => {
    openAiCreateMock.mockResolvedValue(
      createChunkStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"REA'
                    }
                  }
                ]
              },
              finish_reason: null,
              index: 0
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: 'DME.md"}'
                    }
                  }
                ]
              },
              finish_reason: "tool_calls",
              index: 0
            }
          ]
        }
      ])
    );

    const plugin = openaiChatCompletionsPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "tool_use_delta",
        id: "call_1",
        name: "read_file",
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

  it("emits tool_use_json_parse_error when buffered tool args are invalid JSON", async () => {
    openAiCreateMock.mockResolvedValue(
      createChunkStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":'
                    }
                  }
                ]
              },
              finish_reason: null,
              index: 0
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: "README.md"
                    }
                  }
                ]
              },
              finish_reason: "tool_calls",
              index: 0
            }
          ]
        }
      ])
    );

    const plugin = openaiChatCompletionsPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(response!)).toEqual([
      {
        type: "tool_use_delta",
        id: "call_1",
        name: "read_file",
        argsDelta: '{"path":'
      },
      {
        type: "tool_use_delta",
        id: "call_1",
        argsDelta: "README.md"
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

  it("maps final chunk usage into a usage event including cache counters", async () => {
    openAiCreateMock.mockResolvedValue(
      createChunkStream([
        {
          choices: [
            {
              delta: {
                content: "ok"
              },
              finish_reason: null,
              index: 0
            }
          ]
        },
        {
          choices: [
            {
              delta: {},
              finish_reason: "stop",
              index: 0
            }
          ],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 34,
            total_tokens: 1234,
            prompt_tokens_details: {
              cached_tokens: 800
            },
            cache_creation_input_tokens: 50
          }
        }
      ])
    );

    const plugin = openaiChatCompletionsPlugin({ apiKey: "test-key" });
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
        text: "ok"
      },
      {
        type: "usage",
        inputTokens: 1200,
        outputTokens: 34,
        cachedTokens: 800,
        cacheCreationTokens: 50
      },
      {
        type: "stop",
        reason: "end_turn"
      }
    ]);
  });

  it("falls back to cache_read_input_tokens when cached_tokens details are absent", async () => {
    openAiCreateMock.mockResolvedValue(
      createChunkStream([
        {
          choices: [
            {
              delta: {
                content: "ok"
              },
              finish_reason: null,
              index: 0
            }
          ]
        },
        {
          choices: [
            {
              delta: {},
              finish_reason: "stop",
              index: 0
            }
          ],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 34,
            cache_read_input_tokens: 800,
            cache_creation_input_tokens: 50
          }
        }
      ])
    );

    const plugin = openaiChatCompletionsPlugin({ apiKey: "test-key" });
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
        text: "ok"
      },
      {
        type: "usage",
        inputTokens: 1200,
        outputTokens: 34,
        cachedTokens: 800,
        cacheCreationTokens: 50
      },
      {
        type: "stop",
        reason: "end_turn"
      }
    ]);
  });

  it("falls back to auth-store when apiKey option is omitted", async () => {
    storeGetMock.mockResolvedValue("stored-key");
    openAiCreateMock.mockResolvedValue(
      createChunkStream([
        {
          choices: [
            {
              delta: {
                content: "ok"
              },
              finish_reason: "stop",
              index: 0
            }
          ]
        }
      ])
    );

    const fetchMock = vi.fn(globalThis.fetch);
    const plugin = openaiChatCompletionsPlugin();
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: fetchMock,
      options: {}
    });

    await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(createSecretStoreMock).toHaveBeenCalledOnce();
    expect(openAiConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "stored-key",
        baseURL: "https://api.poe.com/v1",
        fetch: fetchMock
      })
    );
  });

  it("uses POE_BASE_URL and ignores OPENAI_BASE_URL for Poe credentials", async () => {
    storeGetMock.mockResolvedValue("stored-key");
    process.env.POE_BASE_URL = "https://poe-proxy.example.com/v1";
    process.env.OPENAI_BASE_URL = "https://foreign.example.com/v1";

    await openaiChatCompletionsPlugin().providers?.[0]?.createModel("gpt-5.4", {
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

  it("propagates AbortError from an aborted stream", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    openAiCreateMock.mockResolvedValue({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            throw abortError;
          }
        };
      }
    });

    const plugin = openaiChatCompletionsPlugin({ apiKey: "test-key" });
    const model = await plugin.providers?.[0]?.createModel("gpt-5.4", {
      fetch: globalThis.fetch,
      options: {}
    });

    const response = await model?.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    await expect(collectProviderEvents(response!)).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("passes tool names through verbatim", async () => {
    openAiCreateMock.mockResolvedValue(
      createChunkStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "superintendent-tools_workflow_transition",
                      arguments: "{}"
                    }
                  }
                ]
              },
              finish_reason: "tool_calls",
              index: 0
            }
          ]
        }
      ])
    );

    const plugin = openaiChatCompletionsPlugin({ apiKey: "test-key" });
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
        name: "superintendent-tools_workflow_transition",
        argsDelta: "{}"
      },
      {
        type: "tool_use_complete",
        id: "call_1",
        name: "superintendent-tools_workflow_transition",
        args: {}
      },
      {
        type: "stop",
        reason: "tool_use"
      }
    ]);
  });
});
