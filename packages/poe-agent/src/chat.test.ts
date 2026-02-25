import { describe, expect, it, vi } from "vitest";
import {
  PoeChatService,
  type Tool,
  type ToolCallCallback,
  type ToolExecutor,
} from "./chat.js";

const baseCompletion = {
  id: "cmpl-1",
  object: "chat.completion",
  created: 1,
  model: "Claude-Sonnet-4.5",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createTool(name: string): Tool {
  return {
    type: "function",
    function: {
      name,
      description: `${name} description`,
      parameters: {
        type: "object",
        properties: {},
      },
    },
  };
}

describe("PoeChatService", () => {
  it("posts to /v1/chat/completions and keeps conversation history", async () => {
    const fetchMock = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hello there" },
              finish_reason: "stop",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "how can I help?" },
              finish_reason: "stop",
            },
          ],
        }),
      );

    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
    });

    await chat.sendMessage("hi");
    await chat.sendMessage("what next?");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.poe.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
      }),
    );

    const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    expect(secondBody).toEqual({
      model: "Claude-Sonnet-4.5",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello there" },
        { role: "user", content: "what next?" },
      ],
    });
  });

  it("executes tool calls and continues until final assistant response", async () => {
    const fetchMock = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"README.md"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Done" },
              finish_reason: "stop",
            },
          ],
        }),
      );

    const executor: ToolExecutor = {
      executeTool: vi.fn(async () => "README content"),
    };

    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor: executor,
    });

    const finalMessage = await chat.sendMessage("Read the README", {
      tools: [createTool("read_file")],
    });

    expect(executor.executeTool).toHaveBeenCalledWith("read_file", { path: "README.md" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(finalMessage).toEqual({ role: "assistant", content: "Done" });

    const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    expect(secondBody.messages).toEqual([
      { role: "user", content: "Read the README" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"path":"README.md"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        name: "read_file",
        content: "README content",
      },
    ]);
  });

  it("stops when tool loop hits the max iteration bound", async () => {
    const fetchMock = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async () =>
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "loop-call",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"loop.txt"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );

    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor: {
        executeTool: vi.fn(async () => "loop"),
      },
    });

    await expect(chat.sendMessage("loop forever")).rejects.toThrow(
      "Maximum tool call iterations reached",
    );
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });

  it("emits tool lifecycle callback events for success", async () => {
    const fetchMock = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call-2",
                    type: "function",
                    function: {
                      name: "search_web",
                      arguments: '{"query":"poe"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "result" },
              finish_reason: "stop",
            },
          ],
        }),
      );

    const callback: ToolCallCallback = vi.fn();

    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor: {
        executeTool: vi.fn(async () => "search output"),
      },
      onToolCall: callback,
    });

    await chat.sendMessage("search", { tools: [createTool("search_web")] });

    expect(callback).toHaveBeenNthCalledWith(1, {
      phase: "started",
      toolCallId: "call-2",
      toolName: "search_web",
      args: { query: "poe" },
    });
    expect(callback).toHaveBeenNthCalledWith(2, {
      phase: "completed",
      toolCallId: "call-2",
      toolName: "search_web",
      args: { query: "poe" },
      result: "search output",
    });
  });

  it("emits tool lifecycle callback events for failures", async () => {
    const fetchMock = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call-3",
                    type: "function",
                    function: {
                      name: "run_command",
                      arguments: '{"command":"ls"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseCompletion,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "handled" },
              finish_reason: "stop",
            },
          ],
        }),
      );

    const callback: ToolCallCallback = vi.fn();

    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor: {
        executeTool: vi.fn(async () => {
          throw new Error("command failed");
        }),
      },
      onToolCall: callback,
    });

    await chat.sendMessage("run", { tools: [createTool("run_command")] });

    expect(callback).toHaveBeenNthCalledWith(1, {
      phase: "started",
      toolCallId: "call-3",
      toolName: "run_command",
      args: { command: "ls" },
    });
    expect(callback).toHaveBeenNthCalledWith(2, {
      phase: "failed",
      toolCallId: "call-3",
      toolName: "run_command",
      args: { command: "ls" },
      error: "command failed",
    });

    const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    expect(secondBody.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call-3",
      name: "run_command",
      content: "Error: command failed",
    });
  });
});
