import { beforeEach, describe, expect, it, vi } from "vitest";

const storeGetMock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>());
const createSecretStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    store: {
      get: storeGetMock,
    },
  })),
);

vi.mock("auth-store", () => ({
  createSecretStore: createSecretStoreMock,
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
                      arguments: "{\"path\":\"diagram.png\"}",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const model = await createPoeAcpModel({
      model: "anthropic/claude-sonnet-4.6",
      apiKey: "test-key",
      baseUrl: "http://localhost:3456/",
      fetch: fetchMock,
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
              retriable: true,
            },
          ],
        },
      ],
      tools: [
        {
          name: "read_file",
          description: "Read file contents",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      ],
      signal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3456/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
      }),
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
                url: "data:image/png;base64,YmFzZTY0LWltYWdl",
              },
            },
            {
              type: "text",
              text: "{\"type\":\"error\",\"code\":\"parse_error\",\"message\":\"Retry with valid JSON\",\"retriable\":true}",
            },
          ],
        },
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
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        },
      ],
    });
    expect(result).toEqual({
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
              arguments: "{\"path\":\"diagram.png\"}",
            },
          },
        ],
      },
    });
  });

  it("loads the Poe API key from auth-store when apiKey is omitted", async () => {
    storeGetMock.mockResolvedValue("stored-key");
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "done",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const model = await createPoeAcpModel({
      model: "gpt-5",
      fetch: fetchMock,
    });

    await model.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(createSecretStoreMock).toHaveBeenCalledWith({
      backendEnvVar: "POE_AUTH_BACKEND",
      fileStore: {
        salt: "poe-code:encrypted-file-auth-store:v1",
        defaultDirectory: ".poe-code",
        defaultFileName: "credentials.enc",
      },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer stored-key",
      }),
    );
  });
});
