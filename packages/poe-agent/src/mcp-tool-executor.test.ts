import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { McpClient, createTestPair, type CallToolResult, type Tool as McpTool } from "tiny-mcp-client";
import { createTestServer } from "tiny-stdio-mcp-test-server";
import {
  McpToolExecutor,
  callToolResultToString,
  mcpToolToOpenAiTool,
  namespaceMcpToolName,
} from "./mcp-tool-executor.js";
import type {
  McpHttpServerDefinition,
  McpServerDefinition,
  McpStdioServerDefinition,
} from "./mcp-tool-executor.js";
import type { Tool } from "./chat.js";

interface ToolClientRegistration {
  client: unknown;
  originalName: string;
}

function getExecutorState(executor: McpToolExecutor): {
  discoveredTools: Tool[];
  toolToClient: Map<string, ToolClientRegistration>;
} {
  return executor as unknown as {
    discoveredTools: Tool[];
    toolToClient: Map<string, ToolClientRegistration>;
  };
}

describe("namespaceMcpToolName", () => {
  it('returns "mcp__<serverName>__<toolName>" for basic names', () => {
    expect(namespaceMcpToolName("my-server", "my-tool")).toBe(
      "mcp__my-server__my-tool",
    );
  });

  it("preserves tool name special characters", () => {
    expect(namespaceMcpToolName("server", "my-tool_v2.0")).toBe(
      "mcp__server__my-tool_v2.0",
    );
  });
});

describe("mcpToolToOpenAiTool", () => {
  it("converts full MCP tool definition to OpenAI function format", () => {
    const mcpTool: McpTool = {
      name: "caesar_cipher_encrypt",
      description: "Encrypt text with a Caesar cipher",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          shift: { type: "number" },
        },
        required: ["text", "shift"],
      },
    };

    expect(mcpToolToOpenAiTool("test-server", mcpTool)).toEqual({
      type: "function",
      function: {
        name: "mcp__test-server__caesar_cipher_encrypt",
        description: "Encrypt text with a Caesar cipher",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
            shift: { type: "number" },
          },
          required: ["text", "shift"],
        },
      },
    });
  });

  it("defaults description to an empty string when missing", () => {
    const mcpTool: McpTool = {
      name: "word_of_the_day",
      inputSchema: {
        type: "object",
        properties: {},
      },
    };

    expect(mcpToolToOpenAiTool("test-server", mcpTool).function.description).toBe("");
  });

  it("defaults parameters.properties to an empty object when input schema properties are missing", () => {
    const mcpTool: McpTool = {
      name: "word_of_the_day",
      description: "Returns the current word of the day",
      inputSchema: {
        type: "object",
      },
    };

    expect(mcpToolToOpenAiTool("test-server", mcpTool).function.parameters.properties).toEqual(
      {},
    );
  });

  it("omits parameters.required when input schema required is missing and namespaces via namespaceMcpToolName", () => {
    const mcpTool: McpTool = {
      name: "word_of_the_day",
      description: "Returns the current word of the day",
      inputSchema: {
        type: "object",
        properties: {
          locale: { type: "string" },
        },
      },
    };

    const converted = mcpToolToOpenAiTool("test-server", mcpTool);
    expect(converted.function.name).toBe(namespaceMcpToolName("test-server", "word_of_the_day"));
    expect(converted.function.parameters).not.toHaveProperty("required");
  });
});

describe("callToolResultToString", () => {
  it("returns text content directly", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: "hello" }],
    };

    expect(callToolResultToString(result)).toBe("hello");
  });

  it('formats image content as "[image: <mime>]":', () => {
    const result: CallToolResult = {
      content: [{ type: "image", mimeType: "image/png", data: "base64-image" }],
    };

    expect(callToolResultToString(result)).toBe("[image: image/png]");
  });

  it('formats audio content as "[audio: <mime>]":', () => {
    const result: CallToolResult = {
      content: [{ type: "audio", mimeType: "audio/wav", data: "base64-audio" }],
    };

    expect(callToolResultToString(result)).toBe("[audio: audio/wav]");
  });

  it("returns embedded resource text", () => {
    const result: CallToolResult = {
      content: [{ type: "resource", resource: { uri: "file:///x", text: "resource-content" } }],
    };

    expect(callToolResultToString(result)).toBe("resource-content");
  });

  it('formats embedded blob resources as "[blob: <uri>]":', () => {
    const result: CallToolResult = {
      content: [{ type: "resource", resource: { uri: "file:///x", blob: "base64-blob" } }],
    };

    expect(callToolResultToString(result)).toBe("[blob: file:///x]");
  });

  it('joins multiple content items with "\\n"', () => {
    const result: CallToolResult = {
      content: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
    };

    expect(callToolResultToString(result)).toBe("line1\nline2");
  });

  it('handles mixed content (text + image) as "some text\\n[image: image/jpeg]"', () => {
    const result: CallToolResult = {
      content: [
        { type: "text", text: "some text" },
        { type: "image", mimeType: "image/jpeg", data: "base64-image" },
      ],
    };

    expect(callToolResultToString(result)).toBe("some text\n[image: image/jpeg]");
  });

  it("returns an empty string for empty content", () => {
    const result: CallToolResult = {
      content: [],
    };

    expect(callToolResultToString(result)).toBe("");
  });

  it("throws when isError is true using extracted content text", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: "something broke" }],
      isError: true,
    };

    expect(() => callToolResultToString(result)).toThrow("something broke");
  });
});

describe("MCP server definition types", () => {
  it("exports the MCP type module", async () => {
    const module = await import("./mcp-tool-executor.js");
    expect(module).toBeTypeOf("object");
  });

  it("supports stdio server definitions", () => {
    const server: McpStdioServerDefinition = {
      transport: "stdio",
      command: "tiny-stdio-mcp-test-server",
      args: ["serve", "word-of-the-day"],
      env: { MCP_LOG_LEVEL: "debug" },
    };

    expect(server.command).toBe("tiny-stdio-mcp-test-server");
    expectTypeOf(server.transport).toEqualTypeOf<"stdio">();
    expectTypeOf(server.args).toEqualTypeOf<string[] | undefined>();
    expectTypeOf(server.env).toEqualTypeOf<Record<string, string> | undefined>();
  });

  it("supports http server definitions", () => {
    const server: McpHttpServerDefinition = {
      transport: "http",
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer token",
      },
    };

    expect(server.url).toBe("https://example.com/mcp");
    expectTypeOf(server.transport).toEqualTypeOf<"http">();
    expectTypeOf(server.headers).toEqualTypeOf<Record<string, string> | undefined>();
  });

  it("uses transport as a discriminator for the union", () => {
    const server: McpServerDefinition = {
      transport: "http",
      url: "https://example.com/mcp",
    };

    if (server.transport === "http") {
      expect(server.url).toBe("https://example.com/mcp");
      return;
    }

    expect(server.command).toBeTypeOf("string");
  });
});

describe("McpToolExecutor.addServer", () => {
  it("discovers tools from createTestPair + createTestServer and namespaces names", async () => {
    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      }),
    );
    const executor = new McpToolExecutor();

    try {
      await executor.addServer("test-server", client);
    } finally {
      await cleanup();
    }

    const { discoveredTools, toolToClient } = getExecutorState(executor);
    const names = discoveredTools.map(tool => tool.function.name).sort();

    expect(names).toContain("mcp__test-server__caesar_cipher_encrypt");
    expect(names).toContain("mcp__test-server__word_of_the_day");
    expect(toolToClient.get("mcp__test-server__caesar_cipher_encrypt")).toEqual({
      client,
      originalName: "caesar_cipher_encrypt",
    });
  });

  it("handles server with zero tools without error", async () => {
    const listTools = vi.fn(async () => ({ tools: [] as McpTool[] }));
    const executor = new McpToolExecutor();

    await expect(executor.addServer("empty-server", { listTools })).resolves.toBeUndefined();

    expect(listTools).toHaveBeenCalledTimes(1);
    expect(executor.getAvailableTools()).toEqual([]);
  });

  it("handles paginated tool discovery and converts each tool to OpenAI format", async () => {
    const firstTool: McpTool = {
      name: "tool_one",
      description: "First tool",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
          },
        },
        required: ["text"],
      },
    };
    const secondTool: McpTool = {
      name: "tool_two",
      description: "Second tool",
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "number",
          },
        },
      },
    };
    const listTools = vi.fn(async (params?: { cursor?: string }) => {
      if (params?.cursor === "page-2") {
        return { tools: [secondTool] };
      }

      return {
        tools: [firstTool],
        nextCursor: "page-2",
      };
    });
    const client = { listTools };
    const executor = new McpToolExecutor();

    await executor.addServer("paginated-server", client);

    const { discoveredTools, toolToClient } = getExecutorState(executor);
    expect(listTools).toHaveBeenCalledTimes(2);
    expect(listTools).toHaveBeenNthCalledWith(1);
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: "page-2" });
    expect(discoveredTools).toContainEqual(mcpToolToOpenAiTool("paginated-server", firstTool));
    expect(discoveredTools).toContainEqual(mcpToolToOpenAiTool("paginated-server", secondTool));
    expect(toolToClient.get("mcp__paginated-server__tool_one")).toEqual({
      client,
      originalName: "tool_one",
    });
    expect(toolToClient.get("mcp__paginated-server__tool_two")).toEqual({
      client,
      originalName: "tool_two",
    });
  });

  it("prevents collisions for duplicate tool names across servers", async () => {
    const sharedTool: McpTool = {
      name: "encrypt",
      inputSchema: {
        type: "object",
      },
    };
    const serverAClient = {
      listTools: vi.fn(async () => ({ tools: [sharedTool] })),
    };
    const serverBClient = {
      listTools: vi.fn(async () => ({ tools: [sharedTool] })),
    };
    const executor = new McpToolExecutor();

    await executor.addServer("server-a", serverAClient);
    await executor.addServer("server-b", serverBClient);

    const { discoveredTools, toolToClient } = getExecutorState(executor);
    const discoveredNames = discoveredTools.map(tool => tool.function.name);

    expect(discoveredNames).toContain("mcp__server-a__encrypt");
    expect(discoveredNames).toContain("mcp__server-b__encrypt");
    expect(toolToClient.get("mcp__server-a__encrypt")).toEqual({
      client: serverAClient,
      originalName: "encrypt",
    });
    expect(toolToClient.get("mcp__server-b__encrypt")).toEqual({
      client: serverBClient,
      originalName: "encrypt",
    });
  });
});

describe("McpToolExecutor.executeTool", () => {
  it("routes namespaced caesar_cipher_encrypt to the MCP client and returns cipher text", async () => {
    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      }),
    );
    const executor = new McpToolExecutor();

    try {
      await executor.addServer("test-server", client);
      await expect(
        executor.executeTool("mcp__test-server__caesar_cipher_encrypt", { text: "hello" }),
      ).resolves.toBe("khoor");
    } finally {
      await cleanup();
    }
  });

  it("returns Bumfuzzle from word_of_the_day tool", async () => {
    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      }),
    );
    const executor = new McpToolExecutor();

    try {
      await executor.addServer("test-server", client);
      await expect(executor.executeTool("mcp__test-server__word_of_the_day", {})).resolves.toContain(
        "Bumfuzzle",
      );
    } finally {
      await cleanup();
    }
  });

  it('throws "MCP tool not found: <name>" for unknown tools', async () => {
    const executor = new McpToolExecutor();

    await expect(executor.executeTool("unknown_tool", {})).rejects.toThrow(
      "MCP tool not found: unknown_tool",
    );
  });

  it("calls client.callTool with original tool name and arguments", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "done" }],
    }));
    const executor = new McpToolExecutor();

    await executor.addServer("test-server", {
      listTools: vi.fn(async () => ({
        tools: [{ name: "word_of_the_day", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool,
    });

    await expect(executor.executeTool("mcp__test-server__word_of_the_day", { locale: "en-US" })).resolves.toBe(
      "done",
    );
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      name: "word_of_the_day",
      arguments: { locale: "en-US" },
    });
  });

  it("routes namespaced tools with special characters and preserves original callTool name", async () => {
    const callTool = vi.fn(async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "special tool result" }],
    }));
    const executor = new McpToolExecutor();

    await executor.addServer("server", {
      listTools: vi.fn(async () => ({
        tools: [
          {
            name: "my-tool_v2.0",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      })),
      callTool,
    });

    expect(executor.getAvailableTools().map(tool => tool.function.name)).toContain(
      "mcp__server__my-tool_v2.0",
    );
    await expect(executor.executeTool("mcp__server__my-tool_v2.0", {})).resolves.toBe(
      "special tool result",
    );
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      name: "my-tool_v2.0",
      arguments: {},
    });
  });

  it("returns joined string for tools that emit multiple content items", async () => {
    const executor = new McpToolExecutor();
    const callTool = vi.fn(async (): Promise<CallToolResult> => ({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    }));

    await executor.addServer("multi", {
      listTools: vi.fn(async () => ({
        tools: [{ name: "multi", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool,
    });

    await expect(executor.executeTool("mcp__multi__multi", {})).resolves.toBe("first\nsecond");
  });

  it('returns "[image: <mime>]" for image tool results', async () => {
    const executor = new McpToolExecutor();

    await executor.addServer("image", {
      listTools: vi.fn(async () => ({
        tools: [{ name: "render", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({
        content: [{ type: "image", mimeType: "image/png", data: "base64" }],
      })),
    });

    await expect(executor.executeTool("mcp__image__render", {})).resolves.toBe("[image: image/png]");
  });

  it("throws when tool returns isError result", async () => {
    const executor = new McpToolExecutor();

    await executor.addServer("failing", {
      listTools: vi.fn(async () => ({
        tools: [{ name: "explode", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({
        content: [{ type: "text", text: "tool broke" }],
        isError: true,
      })),
    });

    await expect(executor.executeTool("mcp__failing__explode", {})).rejects.toThrow("tool broke");
  });

  it("returns empty string for empty tool content", async () => {
    const executor = new McpToolExecutor();

    await executor.addServer("empty", {
      listTools: vi.fn(async () => ({
        tools: [{ name: "blank", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({
        content: [],
      })),
    });

    await expect(executor.executeTool("mcp__empty__blank", {})).resolves.toBe("");
  });

  it("routes interleaved calls to the correct servers", async () => {
    const callToolA = vi.fn(async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "server-a" }],
    }));
    const callToolB = vi.fn(async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "server-b" }],
    }));
    const executor = new McpToolExecutor();

    await executor.addServer("server-a", {
      listTools: vi.fn(async () => ({
        tools: [{ name: "tool", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool: callToolA,
    });
    await executor.addServer("server-b", {
      listTools: vi.fn(async () => ({
        tools: [{ name: "tool", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool: callToolB,
    });

    await expect(executor.executeTool("mcp__server-a__tool", { value: 1 })).resolves.toBe("server-a");
    await expect(executor.executeTool("mcp__server-b__tool", { value: 2 })).resolves.toBe("server-b");

    expect(callToolA).toHaveBeenCalledWith({ name: "tool", arguments: { value: 1 } });
    expect(callToolB).toHaveBeenCalledWith({ name: "tool", arguments: { value: 2 } });
  });

  it("discovers and executes duplicate encrypt tools independently across servers", async () => {
    const callToolA = vi.fn(async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "server-a-encrypted" }],
    }));
    const callToolB = vi.fn(async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "server-b-encrypted" }],
    }));
    const encryptTool: McpTool = {
      name: "encrypt",
      description: "Encrypt text",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
    };
    const executor = new McpToolExecutor();

    await executor.addServer("server-a", {
      listTools: vi.fn(async () => ({ tools: [encryptTool] })),
      callTool: callToolA,
    });
    await executor.addServer("server-b", {
      listTools: vi.fn(async () => ({ tools: [encryptTool] })),
      callTool: callToolB,
    });

    const discoveredNames = executor.getAvailableTools().map(tool => tool.function.name);
    expect(discoveredNames).toContain("mcp__server-a__encrypt");
    expect(discoveredNames).toContain("mcp__server-b__encrypt");

    await expect(executor.executeTool("mcp__server-a__encrypt", { text: "alpha" })).resolves.toBe(
      "server-a-encrypted",
    );
    await expect(executor.executeTool("mcp__server-b__encrypt", { text: "beta" })).resolves.toBe(
      "server-b-encrypted",
    );

    expect(callToolA).toHaveBeenCalledWith({ name: "encrypt", arguments: { text: "alpha" } });
    expect(callToolB).toHaveBeenCalledWith({ name: "encrypt", arguments: { text: "beta" } });
  });
});

describe("McpToolExecutor.dispose", () => {
  it("closes all connected clients", async () => {
    const firstClient = {
      state: "ready",
      listTools: vi.fn(async () => ({ tools: [] as McpTool[] })),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({ content: [] })),
      close: vi.fn(async function close(this: { state: string }) {
        this.state = "closed";
      }),
    };
    const secondClient = {
      state: "ready",
      listTools: vi.fn(async () => ({ tools: [] as McpTool[] })),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({ content: [] })),
      close: vi.fn(async function close(this: { state: string }) {
        this.state = "closed";
      }),
    };
    const executor = new McpToolExecutor();

    await executor.addServer("first", firstClient);
    await executor.addServer("second", secondClient);
    await executor.dispose();

    expect(firstClient.state).toBe("closed");
    expect(secondClient.state).toBe("closed");
  });

  it("closes all clients even when one close call throws", async () => {
    const firstClient = {
      state: "ready",
      listTools: vi.fn(async () => ({ tools: [] as McpTool[] })),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({ content: [] })),
      close: vi.fn(async function close(this: { state: string }) {
        this.state = "closed";
        throw new Error("first close failed");
      }),
    };
    const secondClient = {
      state: "ready",
      listTools: vi.fn(async () => ({ tools: [] as McpTool[] })),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({ content: [] })),
      close: vi.fn(async function close(this: { state: string }) {
        this.state = "closed";
      }),
    };
    const executor = new McpToolExecutor();

    await executor.addServer("first", firstClient);
    await executor.addServer("second", secondClient);

    await expect(executor.dispose()).resolves.toBeUndefined();
    expect(firstClient.state).toBe("closed");
    expect(secondClient.state).toBe("closed");
    expect(firstClient.close).toHaveBeenCalledTimes(1);
    expect(secondClient.close).toHaveBeenCalledTimes(1);
  });

  it("throws when executeTool is called after dispose", async () => {
    const callTool = vi.fn(async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const client = {
      state: "ready",
      listTools: vi.fn(async () => ({
        tools: [{ name: "word_of_the_day", inputSchema: { type: "object", properties: {} } }],
      })),
      callTool,
      close: vi.fn(async function close(this: { state: string }) {
        this.state = "closed";
      }),
    };
    const executor = new McpToolExecutor();

    await executor.addServer("test-server", client);
    await executor.dispose();

    await expect(executor.executeTool("mcp__test-server__word_of_the_day", {})).rejects.toThrow(
      "MCP tool executor is disposed",
    );
    expect(client.state).toBe("closed");
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe("McpToolExecutor.getAvailableTools", () => {
  it("returns all discovered tools in OpenAI format", async () => {
    const executor = new McpToolExecutor();
    const alphaTool: McpTool = {
      name: "alpha",
      description: "Alpha tool",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    };

    await executor.addServer("server-a", {
      listTools: vi.fn(async () => ({ tools: [alphaTool] })),
    });

    expect(executor.getAvailableTools()).toEqual([mcpToolToOpenAiTool("server-a", alphaTool)]);
  });

  it("includes tools from every paginated listTools page", async () => {
    const executor = new McpToolExecutor();
    const firstTool: McpTool = {
      name: "tool_one",
      description: "First tool",
      inputSchema: { type: "object", properties: {} },
    };
    const secondTool: McpTool = {
      name: "tool_two",
      description: "Second tool",
      inputSchema: { type: "object", properties: {} },
    };
    const listTools = vi.fn(async (params?: { cursor?: string }) => {
      if (params?.cursor === "page2") {
        return { tools: [secondTool] };
      }

      return {
        tools: [firstTool],
        nextCursor: "page2",
      };
    });

    await executor.addServer("paginated-server", { listTools });

    expect(listTools).toHaveBeenCalledTimes(2);
    expect(listTools).toHaveBeenNthCalledWith(1);
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: "page2" });
    expect(executor.getAvailableTools()).toEqual([
      mcpToolToOpenAiTool("paginated-server", firstTool),
      mcpToolToOpenAiTool("paginated-server", secondTool),
    ]);
  });

  it("returns discovered tools from both servers after addServer is called twice", async () => {
    const executor = new McpToolExecutor();
    const toolA: McpTool = {
      name: "encrypt",
      description: "Encrypt",
      inputSchema: { type: "object", properties: {} },
    };
    const toolB: McpTool = {
      name: "decrypt",
      description: "Decrypt",
      inputSchema: { type: "object", properties: {} },
    };

    await executor.addServer("server-a", {
      listTools: vi.fn(async () => ({ tools: [toolA] })),
    });
    await executor.addServer("server-b", {
      listTools: vi.fn(async () => ({ tools: [toolB] })),
    });

    expect(executor.getAvailableTools()).toEqual([
      mcpToolToOpenAiTool("server-a", toolA),
      mcpToolToOpenAiTool("server-b", toolB),
    ]);
  });

  it("returns tools with namespaced function.name", async () => {
    const executor = new McpToolExecutor();
    const tool: McpTool = {
      name: "word_of_the_day",
      description: "Returns the current word",
      inputSchema: { type: "object", properties: {} },
    };

    await executor.addServer("test-server", {
      listTools: vi.fn(async () => ({ tools: [tool] })),
    });

    expect(executor.getAvailableTools()[0]?.function.name).toBe(
      "mcp__test-server__word_of_the_day",
    );
  });
});
