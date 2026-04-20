import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectProviderEvents } from "../testing/model-response.js";

const storeGetMock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>());
const createSecretStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    store: {
      get: storeGetMock
    }
  }))
);

vi.mock("auth-store", () => ({
  createSecretStore: createSecretStoreMock
}));

import { createPoeAcpModel } from "./poe.js";

describe("createPoeAcpModel", () => {
  beforeEach(() => {
    createSecretStoreMock.mockClear();
    storeGetMock.mockReset();
  });

  it("serializes Poe chat completion requests and preserves reasoning fields", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "done",
                reasoning_content: "Need more context",
                reasoning: "Need more context",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"diagram.png"}'
                    }
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });
    const model = await createPoeAcpModel({
      model: "anthropic/claude-sonnet-4.6",
      apiKey: "test-key",
      baseUrl: "http://localhost:3456/",
      fetch: fetchMock
    });

    const result = await model.complete({
      messages: [
        {
          role: "tool",
          tool_call_id: "call-1",
          name: "read_file",
          content: [
            { type: "text", text: "Screenshot captured" },
            { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" },
            {
              type: "error",
              code: "parse_error",
              message: "Retry with valid JSON",
              retriable: true
            }
          ]
        }
      ],
      tools: [
        {
          name: "read_file",
          description: "Read file contents",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" }
            },
            required: ["path"]
          }
        }
      ],
      signal: new AbortController().signal
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3456/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key"
        })
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: "anthropic/claude-sonnet-4.6",
      messages: [
        {
          role: "tool",
          tool_call_id: "call-1",
          name: "read_file",
          content: [
            { type: "text", text: "Screenshot captured" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,YmFzZTY0LWltYWdl"
              }
            },
            {
              type: "text",
              text: '{"type":"error","code":"parse_error","message":"Retry with valid JSON","retriable":true}'
            }
          ]
        }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read file contents",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" }
              },
              required: ["path"]
            }
          }
        }
      ]
    });
    expect(await collectProviderEvents(result)).toEqual([
      {
        type: "thinking",
        text: "Need more context"
      },
      {
        type: "text",
        text: "done"
      },
      {
        type: "tool_use_complete",
        id: "call-1",
        name: "read_file",
        args: { path: "diagram.png" }
      },
      {
        type: "stop",
        reason: "tool_use"
      }
    ]);
  });

  it("extracts usage including cached tokens when the response provides them", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 34,
            total_tokens: 1234,
            prompt_tokens_details: { cached_tokens: 800 },
            cache_creation_input_tokens: 50
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const model = await createPoeAcpModel({
      model: "anthropic/claude-opus-4.7",
      apiKey: "key",
      fetch: fetchMock
    });

    const result = await model.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(result)).toEqual([
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

  it("omits usage when the response has none", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const model = await createPoeAcpModel({
      model: "anthropic/claude-opus-4.7",
      apiKey: "key",
      fetch: fetchMock
    });

    const result = await model.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(await collectProviderEvents(result)).toEqual([
      {
        type: "text",
        text: "ok"
      },
      {
        type: "stop",
        reason: "end_turn"
      }
    ]);
  });

  it("loads the Poe API key from auth-store when apiKey is omitted", async () => {
    storeGetMock.mockResolvedValue("stored-key");
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "done"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });
    const model = await createPoeAcpModel({
      model: "gpt-5",
      fetch: fetchMock
    });

    await model.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal
    });

    expect(createSecretStoreMock).toHaveBeenCalledWith({
      backendEnvVar: "POE_AUTH_BACKEND",
      fileStore: {
        salt: "poe-code:encrypted-file-auth-store:v1",
        defaultDirectory: ".poe-code",
        defaultFileName: "credentials.enc"
      }
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer stored-key"
      })
    );
  });

  it("passes valid tool names through to the API and preserves response tool_calls", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "ok",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "superintendent-tools_workflow_transition",
                      arguments: "{}"
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const model = await createPoeAcpModel({
      model: "openai/gpt-5.4",
      apiKey: "k",
      baseUrl: "http://localhost:3456/",
      fetch: fetchMock
    });

    const result = await model.complete({
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-0",
              type: "function",
              function: {
                name: "superintendent-tools_workflow_transition",
                arguments: "{}"
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call-0",
          name: "superintendent-tools_workflow_transition",
          content: "done"
        }
      ],
      tools: [
        {
          name: "superintendent-tools_workflow_transition",
          description: "d",
          inputSchema: { type: "object" }
        }
      ],
      signal: new AbortController().signal
    });

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sentBody.tools[0].function.name).toBe("superintendent-tools_workflow_transition");
    expect(sentBody.messages[0].tool_calls[0].function.name).toBe(
      "superintendent-tools_workflow_transition"
    );
    expect(sentBody.messages[1].name).toBe("superintendent-tools_workflow_transition");

    expect(await collectProviderEvents(result)).toEqual([
      {
        type: "text",
        text: "ok"
      },
      {
        type: "tool_use_complete",
        id: "call-1",
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
