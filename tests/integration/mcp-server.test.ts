import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/cli/mcp-server.js";

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
}

describe("MCP Server Protocol Integration", () => {
  let client: Client;
  let closeTransport: () => Promise<void>;

  beforeAll(async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "1.0.0" }, {});

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport)
    ]);

    closeTransport = async () => {
      await client.close();
    };
  });

  afterAll(async () => {
    await closeTransport();
  });

  describe("tools/list", () => {
    it("returns all registered tools", async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(4);

      const toolNames = result.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "generate_audio",
        "generate_image",
        "generate_text",
        "generate_video"
      ]);
    });

    it("each tool has description and input schema", async () => {
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("generate_text has required bot_name and message", async () => {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === "generate_text");

      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain("bot_name");
      expect(tool!.inputSchema.required).toContain("message");
    });

    it("generate_image has required prompt and optional bot_name", async () => {
      const result = await client.listTools();
      const tool = result.tools.find((t) => t.name === "generate_image");

      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain("prompt");
      expect(tool!.inputSchema.required).not.toContain("bot_name");
    });
  });

  describe("tools/call", () => {
    it("generate_text returns text content", async () => {
      const result = await client.callTool({
        name: "generate_text",
        arguments: {
          bot_name: "Claude-3.5-Haiku",
          message: "Reply with exactly: HELLO_WORLD"
        }
      }) as ToolCallResult;

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");
    });

    it("generate_image returns URL for valid image bot", async () => {
      const result = await client.callTool({
        name: "generate_image",
        arguments: {
          prompt: "A golden retriever sitting on a red couch."
        }
      }) as ToolCallResult;

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toMatch(/^https?:\/\//);
    });

    it("generate_video returns URL for valid video bot", async () => {
      const result = await client.callTool({
        name: "generate_video",
        arguments: {
          prompt: "A drone flyover of a forest at sunrise."
        }
      }) as ToolCallResult;

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toMatch(/^https?:\/\//);
    });

    it("generate_audio returns URL for valid audio bot", async () => {
      const result = await client.callTool({
        name: "generate_audio",
        arguments: {
          prompt: "Hello world. This is a short audio test.",
          bot_name: "ElevenLabs-v3"
        }
      }) as ToolCallResult;

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toMatch(/^https?:\/\//);
    });
  });
});
