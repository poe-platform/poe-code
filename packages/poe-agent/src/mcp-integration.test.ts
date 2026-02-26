import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { McpClient, createTestPair } from "tiny-mcp-client";
import { createTestServer } from "tiny-stdio-mcp-test-server";
import { createAgentSession, type AgentSession } from "./agent-session.js";
import type { ChatMessage } from "./chat.js";
import { PoeChatService } from "./chat.js";
import { McpToolExecutor } from "./mcp-tool-executor.js";
import { DefaultToolExecutor, type ToolExecutorFileSystem } from "./tool-executor.js";

function createScriptedFetch(
  responses: Array<{ message: ChatMessage }>,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const queue = [...responses];

  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error("No more scripted responses");
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            index: 0,
            message: next.message,
            finish_reason: next.message.tool_calls ? "tool_calls" : "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  });
}

describe("createScriptedFetch", () => {
  it("returns vi.fn and serves scripted responses in order", async () => {
    const firstMessage: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "read_file",
            arguments: '{"path":"hello.txt"}',
          },
        },
      ],
    };
    const secondMessage: ChatMessage = {
      role: "assistant",
      content: "Final answer",
    };

    const fetchMock = createScriptedFetch([
      { message: firstMessage },
      { message: secondMessage },
    ]);

    expect(vi.isMockFunction(fetchMock)).toBe(true);

    const firstResponse = await fetchMock("https://example.test/first");
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("Content-Type")).toBe("application/json");
    await expect(firstResponse.json()).resolves.toEqual({
      choices: [
        {
          index: 0,
          message: firstMessage,
          finish_reason: "tool_calls",
        },
      ],
    });

    const secondResponse = await fetchMock("https://example.test/second");
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("Content-Type")).toBe("application/json");
    await expect(secondResponse.json()).resolves.toEqual({
      choices: [
        {
          index: 0,
          message: secondMessage,
          finish_reason: "stop",
        },
      ],
    });
  });

  it("throws when scripted responses are exhausted", async () => {
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "only response",
        },
      },
    ]);

    await fetchMock("https://example.test/once");
    await expect(fetchMock("https://example.test/twice")).rejects.toThrow(
      "No more scripted responses",
    );
  });
});

describe("integration: built-in read_file with memfs", () => {
  it("executes read_file, feeds tool result back, and returns final answer", async () => {
    const finalAnswer = "I read it: Hello from memfs!";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"hello.txt"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const volume = Volume.fromJSON(
      {
        "/workspace/hello.txt": "Hello from memfs!",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
    const toolExecutor = new DefaultToolExecutor({
      cwd: "/workspace",
      allowedPaths: ["/workspace"],
      fs,
    });
    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor,
    });

    const result = await chat.sendMessage("Read hello.txt", {
      tools: toolExecutor.getAvailableTools(),
    });

    expect(result.content).toBe(finalAnswer);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    expect(secondRequestBody.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call-1",
      name: "read_file",
      content: "Hello from memfs!",
    });
  });
});

describe("integration: built-in edit_file create + read_file with memfs", () => {
  it("creates a file, reads it back, and includes both tool results in round three", async () => {
    const createdContent = "Created from edit_file";
    const finalAnswer = `Verified content: ${createdContent}`;
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-create",
              type: "function",
              function: {
                name: "edit_file",
                arguments:
                  '{"command":"create","path":"notes/today.txt","file_text":"Created from edit_file"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-read",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"notes/today.txt"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const vol = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(vol).promises as unknown as ToolExecutorFileSystem;
    const toolExecutor = new DefaultToolExecutor({
      cwd: "/workspace",
      allowedPaths: ["/workspace"],
      fs,
    });
    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor,
    });

    const result = await chat.sendMessage("Create notes/today.txt and verify it", {
      tools: toolExecutor.getAvailableTools(),
    });

    expect(result.content).toBe(finalAnswer);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vol.readFileSync("/workspace/notes/today.txt", "utf8")).toBe(createdContent);

    const thirdRequestBody = JSON.parse((fetchMock.mock.calls[2]?.[1]?.body as string) ?? "{}");
    expect(thirdRequestBody.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call-create",
      name: "edit_file",
      content: "Created file: notes/today.txt",
    });
    expect(thirdRequestBody.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call-read",
      name: "read_file",
      content: createdContent,
    });
  });
});

describe("integration: built-in edit_file str_replace with memfs", () => {
  it("edits an existing file and feeds edit confirmation back to the model", async () => {
    const finalAnswer = "Updated docs/note.txt";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-edit",
              type: "function",
              function: {
                name: "edit_file",
                arguments:
                  '{"command":"str_replace","path":"docs/note.txt","old_str":"Hello","new_str":"Hi"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const volume = Volume.fromJSON(
      {
        "/workspace/docs/note.txt": "Hello from memfs",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
    const toolExecutor = new DefaultToolExecutor({
      cwd: "/workspace",
      allowedPaths: ["/workspace"],
      fs,
    });
    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor,
    });

    const result = await chat.sendMessage("Update docs/note.txt", {
      tools: toolExecutor.getAvailableTools(),
    });

    expect(result.content).toBe(finalAnswer);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(volume.readFileSync("/workspace/docs/note.txt", "utf8")).toBe("Hi from memfs");

    const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    expect(secondRequestBody.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call-edit",
      name: "edit_file",
      content: "Edited file: docs/note.txt",
    });
  });
});

describe("integration: built-in multi-turn read/edit/re-read with memfs", () => {
  it("reads config.txt, edits 3000 to 8080, then re-reads updated content", async () => {
    const finalAnswer = "Updated config.txt to port=8080";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-read-initial",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"config.txt"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-edit-port",
              type: "function",
              function: {
                name: "edit_file",
                arguments:
                  '{"command":"str_replace","path":"config.txt","old_str":"3000","new_str":"8080"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-read-updated",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"config.txt"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const volume = Volume.fromJSON(
      {
        "/workspace/config.txt": "port=3000",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
    const toolExecutor = new DefaultToolExecutor({
      cwd: "/workspace",
      allowedPaths: ["/workspace"],
      fs,
    });
    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor,
    });

    const result = await chat.sendMessage("Update config.txt port from 3000 to 8080", {
      tools: toolExecutor.getAvailableTools(),
    });

    expect(result.content).toBe(finalAnswer);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(volume.readFileSync("/workspace/config.txt", "utf8")).toBe("port=8080");

    const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    const thirdRequestBody = JSON.parse((fetchMock.mock.calls[2]?.[1]?.body as string) ?? "{}");
    const fourthRequestBody = JSON.parse((fetchMock.mock.calls[3]?.[1]?.body as string) ?? "{}");

    const secondAssistantToolCallNames = (secondRequestBody.messages as ChatMessage[])
      .filter(message => message.role === "assistant")
      .flatMap(message => message.tool_calls?.map(toolCall => toolCall.function.name) ?? []);
    const thirdAssistantToolCallNames = (thirdRequestBody.messages as ChatMessage[])
      .filter(message => message.role === "assistant")
      .flatMap(message => message.tool_calls?.map(toolCall => toolCall.function.name) ?? []);
    const fourthAssistantToolCallNames = (fourthRequestBody.messages as ChatMessage[])
      .filter(message => message.role === "assistant")
      .flatMap(message => message.tool_calls?.map(toolCall => toolCall.function.name) ?? []);

    expect(secondAssistantToolCallNames).toEqual(["read_file"]);
    expect(thirdAssistantToolCallNames).toEqual(["read_file", "edit_file"]);
    expect(fourthAssistantToolCallNames).toEqual(["read_file", "edit_file", "read_file"]);

    expect(fourthRequestBody.messages).toEqual(
      expect.arrayContaining([
        {
          role: "tool",
          tool_call_id: "call-read-initial",
          name: "read_file",
          content: "port=3000",
        },
        {
          role: "tool",
          tool_call_id: "call-edit-port",
          name: "edit_file",
          content: "Edited file: config.txt",
        },
        {
          role: "tool",
          tool_call_id: "call-read-updated",
          name: "read_file",
          content: "port=8080",
        },
      ]),
    );
  });
});

describe("integration: built-in list_files with memfs", () => {
  it("lists directory contents, feeds tool result back, and returns final answer", async () => {
    const finalAnswer = "I found: a.txt, b.txt, sub";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-list",
              type: "function",
              function: {
                name: "list_files",
                arguments: '{"path":"."}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const volume = Volume.fromJSON(
      {
        "/workspace/a.txt": "A",
        "/workspace/b.txt": "B",
        "/workspace/sub/c.txt": "C",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
    const toolExecutor = new DefaultToolExecutor({
      cwd: "/workspace",
      allowedPaths: ["/workspace"],
      fs,
    });
    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor,
    });

    const result = await chat.sendMessage("List files in the workspace", {
      tools: toolExecutor.getAvailableTools(),
    });

    expect(result.content).toContain("a.txt");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    expect(secondRequestBody.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call-list",
      name: "list_files",
      content: "a.txt\nb.txt\nsub",
    });
  });
});

describe("integration: MCP tool-only session with createTestPair", () => {
  it("executes namespaced caesar cipher and feeds encrypted text back to the LLM", async () => {
    const encryptedText = "vhfuhw=42";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-mcp-1",
              type: "function",
              function: {
                name: "mcp__test-server__caesar_cipher_encrypt",
                arguments: '{"text":"secret=42","shift":3}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: `Encrypted text: ${encryptedText}`,
        },
      },
    ]);

    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      }),
    );
    const mcpToolExecutor = new McpToolExecutor();

    try {
      await mcpToolExecutor.addServer("test-server", client);
      const chat = new PoeChatService({
        apiKey: "test-key",
        model: "Claude-Sonnet-4.5",
        fetch: fetchMock,
        toolExecutor: mcpToolExecutor,
      });

      const result = await chat.sendMessage("Encrypt secret=42", {
        tools: mcpToolExecutor.getAvailableTools(),
      });

      expect(result.content).toContain(encryptedText);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const firstRequestBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
      expect(Array.isArray(firstRequestBody.tools)).toBe(true);

      const firstRequestTools = firstRequestBody.tools as Array<{
        type: string;
        function: {
          name: string;
          parameters: {
            properties: Record<string, { type?: string }>;
            required?: string[];
          };
        };
      }>;
      const caesarTool = firstRequestTools.find(
        tool => tool.function?.name === "mcp__test-server__caesar_cipher_encrypt",
      );

      expect(caesarTool).toBeDefined();
      expect(caesarTool?.type).toBe("function");
      expect(caesarTool?.function.parameters.properties).toMatchObject({
        text: { type: "string" },
        shift: { type: "number" },
      });
      expect(caesarTool?.function.parameters.required).toEqual(["text"]);

      const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
      expect(secondRequestBody.messages).toContainEqual({
        role: "tool",
        tool_call_id: "call-mcp-1",
        name: "mcp__test-server__caesar_cipher_encrypt",
        content: encryptedText,
      });
    } finally {
      await cleanup();
    }
  });
});

describe("integration: built-in + MCP tools in one session", () => {
  it("calls read_file first, then MCP caesar cipher, and feeds both results back", async () => {
    const fileContent = "secret=42";
    const encryptedText = "vhfuhw=42";
    const finalAnswer = `Read ${fileContent} and encrypted it to ${encryptedText}`;
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-read",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"secret.txt"}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-mcp",
              type: "function",
              function: {
                name: "mcp__test-server__caesar_cipher_encrypt",
                arguments: '{"text":"secret=42","shift":3}',
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const volume = Volume.fromJSON(
      {
        "/workspace/secret.txt": fileContent,
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
    const builtInToolExecutor = new DefaultToolExecutor({
      cwd: "/workspace",
      allowedPaths: ["/workspace"],
      fs,
    });

    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      }),
    );
    const mcpToolExecutor = new McpToolExecutor();

    try {
      await mcpToolExecutor.addServer("test-server", client);

      const builtInTools = builtInToolExecutor.getAvailableTools();
      const mcpTools = mcpToolExecutor.getAvailableTools();
      const builtInToolNames = new Set(builtInTools.map(tool => tool.function.name));

      const chat = new PoeChatService({
        apiKey: "test-key",
        model: "Claude-Sonnet-4.5",
        fetch: fetchMock,
        toolExecutor: {
          executeTool(name: string, args: Record<string, unknown>): Promise<string> {
            if (builtInToolNames.has(name)) {
              return builtInToolExecutor.executeTool(name, args);
            }

            return mcpToolExecutor.executeTool(name, args);
          },
        },
      });

      const result = await chat.sendMessage("Read secret.txt and encrypt its contents", {
        tools: [...builtInTools, ...mcpTools],
      });

      expect(result.content).toContain(fileContent);
      expect(result.content).toContain(encryptedText);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const firstRequestBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
      expect(firstRequestBody.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({
              name: "read_file",
            }),
          }),
          expect.objectContaining({
            function: expect.objectContaining({
              name: "mcp__test-server__caesar_cipher_encrypt",
            }),
          }),
        ]),
      );

      const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
      const secondAssistantToolCallNames = (secondRequestBody.messages as ChatMessage[])
        .filter(message => message.role === "assistant")
        .flatMap(message => message.tool_calls?.map(toolCall => toolCall.function.name) ?? []);

      expect(secondAssistantToolCallNames).toEqual(["read_file"]);
      expect(secondRequestBody.messages).toContainEqual({
        role: "tool",
        tool_call_id: "call-read",
        name: "read_file",
        content: fileContent,
      });

      const thirdRequestBody = JSON.parse((fetchMock.mock.calls[2]?.[1]?.body as string) ?? "{}");
      const thirdAssistantToolCallNames = (thirdRequestBody.messages as ChatMessage[])
        .filter(message => message.role === "assistant")
        .flatMap(message => message.tool_calls?.map(toolCall => toolCall.function.name) ?? []);

      expect(thirdAssistantToolCallNames).toEqual([
        "read_file",
        "mcp__test-server__caesar_cipher_encrypt",
      ]);
      expect(thirdRequestBody.messages).toContainEqual({
        role: "tool",
        tool_call_id: "call-read",
        name: "read_file",
        content: fileContent,
      });
      expect(thirdRequestBody.messages).toContainEqual({
        role: "tool",
        tool_call_id: "call-mcp",
        name: "mcp__test-server__caesar_cipher_encrypt",
        content: encryptedText,
      });
    } finally {
      await cleanup();
    }
  });
});

describe("integration: parallel built-in + MCP tool_calls in one response", () => {
  it("executes read_file and word_of_the_day, then sends both tool results in the next request", async () => {
    const fileContent = "Hello from memfs!";
    const finalAnswer = "Read the file and fetched the word of the day.";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-read",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"hello.txt"}',
              },
            },
            {
              id: "call-word",
              type: "function",
              function: {
                name: "mcp__test-server__word_of_the_day",
                arguments: "{}",
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const volume = Volume.fromJSON(
      {
        "/workspace/hello.txt": fileContent,
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
    const builtInToolExecutor = new DefaultToolExecutor({
      cwd: "/workspace",
      allowedPaths: ["/workspace"],
      fs,
    });

    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      }),
    );
    const mcpToolExecutor = new McpToolExecutor();

    try {
      await mcpToolExecutor.addServer("test-server", client);

      const builtInTools = builtInToolExecutor.getAvailableTools();
      const mcpTools = mcpToolExecutor.getAvailableTools();
      const builtInToolNames = new Set(builtInTools.map(tool => tool.function.name));

      const chat = new PoeChatService({
        apiKey: "test-key",
        model: "Claude-Sonnet-4.5",
        fetch: fetchMock,
        toolExecutor: {
          executeTool(name: string, args: Record<string, unknown>): Promise<string> {
            if (builtInToolNames.has(name)) {
              return builtInToolExecutor.executeTool(name, args);
            }

            return mcpToolExecutor.executeTool(name, args);
          },
        },
      });

      const result = await chat.sendMessage("Read hello.txt and get the word of the day", {
        tools: [...builtInTools, ...mcpTools],
      });

      expect(result.content).toBe(finalAnswer);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
      const secondAssistantToolCallNames = (secondRequestBody.messages as ChatMessage[])
        .filter(message => message.role === "assistant")
        .flatMap(message => message.tool_calls?.map(toolCall => toolCall.function.name) ?? []);
      const secondToolMessages = (secondRequestBody.messages as ChatMessage[]).filter(
        message => message.role === "tool",
      );

      expect(secondAssistantToolCallNames).toEqual([
        "read_file",
        "mcp__test-server__word_of_the_day",
      ]);
      expect(secondToolMessages).toHaveLength(2);
      expect(secondToolMessages).toContainEqual({
        role: "tool",
        tool_call_id: "call-read",
        name: "read_file",
        content: fileContent,
      });
      expect(secondToolMessages).toContainEqual(
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-word",
          name: "mcp__test-server__word_of_the_day",
          content: expect.stringContaining("Bumfuzzle"),
        }),
      );
    } finally {
      await cleanup();
    }
  });
});

describe("integration: unknown tool error propagation", () => {
  it('feeds an "Error: ..." tool result for an unrecognized tool and recovers', async () => {
    const finalAnswer = "That tool does not exist, but I can still continue.";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-unknown",
              type: "function",
              function: {
                name: "nonexistent_tool",
                arguments: "{}",
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      }),
    );
    const mcpToolExecutor = new McpToolExecutor();

    try {
      await mcpToolExecutor.addServer("test-server", client);
      const chat = new PoeChatService({
        apiKey: "test-key",
        model: "Claude-Sonnet-4.5",
        fetch: fetchMock,
        toolExecutor: mcpToolExecutor,
      });

      const result = await chat.sendMessage("Call a fake tool", {
        tools: mcpToolExecutor.getAvailableTools(),
      });

      expect(result.content).toBe(finalAnswer);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
      const toolMessages = (secondRequestBody.messages as ChatMessage[]).filter(
        message => message.role === "tool",
      );

      expect(toolMessages).toContainEqual(
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-unknown",
          name: "nonexistent_tool",
          content: expect.stringContaining("Error"),
        }),
      );
    } finally {
      await cleanup();
    }
  });
});

describe("integration: MCP tool isError propagation", () => {
  it('feeds an "Error: ..." tool result when an MCP tool returns isError and recovers', async () => {
    const finalAnswer = "The MCP tool failed, so I handled it and continued.";
    const fetchMock = createScriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-mcp-error",
              type: "function",
              function: {
                name: "mcp__test-server__broken_tool",
                arguments: "{}",
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: finalAnswer,
        },
      },
    ]);

    const mcpToolExecutor = new McpToolExecutor();
    await mcpToolExecutor.addServer("test-server", {
      listTools: async () => ({
        tools: [
          {
            name: "broken_tool",
            description: "Always fails with isError",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      }),
      callTool: async () => ({
        isError: true,
        content: [{ type: "text", text: "Intentional MCP failure" }],
      }),
    });

    const chat = new PoeChatService({
      apiKey: "test-key",
      model: "Claude-Sonnet-4.5",
      fetch: fetchMock,
      toolExecutor: mcpToolExecutor,
    });

    const result = await chat.sendMessage("Call the broken MCP tool", {
      tools: mcpToolExecutor.getAvailableTools(),
    });

    expect(result.content).toBe(finalAnswer);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondRequestBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
    const toolMessages = (secondRequestBody.messages as ChatMessage[]).filter(
      message => message.role === "tool",
    );

    expect(toolMessages).toContainEqual({
      role: "tool",
      tool_call_id: "call-mcp-error",
      name: "mcp__test-server__broken_tool",
      content: "Error: Intentional MCP failure",
    });
  });
});

describe("integration: agent session disposal with MCP", () => {
  it("closes MCP clients and rejects sendMessage after dispose", async () => {
    const connectSpy = vi.spyOn(McpClient.prototype, "connect");
    let session: AgentSession | undefined;

    try {
      session = await createAgentSession({
        apiKey: "test-key",
        model: "Claude-Sonnet-4.5",
        mcpServers: {
          "test-server": {
            transport: "stdio",
            command: "tiny-stdio-mcp-test-server",
            args: ["serve", "word-of-the-day"],
          },
        },
      });

      const mcpClient = connectSpy.mock.instances[0] as McpClient | undefined;
      expect(mcpClient).toBeDefined();
      expect(mcpClient?.state).toBe("ready");

      await session.dispose();

      expect(mcpClient?.state).toBe("closed");
      await expect(session.sendMessage("after dispose")).rejects.toThrow(
        "Agent session is already disposed.",
      );
    } finally {
      if (session) {
        await session.dispose();
      }

      connectSpy.mockRestore();
    }
  });
});
