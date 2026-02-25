import { createTestServer } from "tiny-stdio-mcp-test-server";
import { describe, expect, it } from "vitest";
import { McpClient, createTestPair } from "./internal.js";

describe("McpClient integration tools with tiny-stdio-mcp-test-server", () => {
  it("completes full lifecycle: connect, list tools, call each tool, and close", async () => {
    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      expect(client.serverInfo).toEqual({
        name: "tiny-stdio-mcp-test-server",
        version: "0.0.1",
      });

      const { tools } = await client.listTools();
      const toolNames = tools.map((tool) => tool.name).sort();

      expect(toolNames).toEqual(["caesar_cipher_encrypt", "word_of_the_day"]);

      const expectedCallResultsByTool: Record<
        string,
        {
          arguments: Record<string, unknown>;
          result: { content: [{ type: "text"; text: string }] };
        }
      > = {
        caesar_cipher_encrypt: {
          arguments: { text: "hello" },
          result: {
            content: [{ type: "text", text: "khoor" }],
          },
        },
        word_of_the_day: {
          arguments: {},
          result: {
            content: [{ type: "text", text: "Bumfuzzle - to confuse or fluster someone" }],
          },
        },
      };

      for (const toolName of toolNames) {
        const expectedCall = expectedCallResultsByTool[toolName];
        expect(expectedCall).toBeDefined();

        if (expectedCall === undefined) {
          continue;
        }

        const result = await client.callTool({
          name: toolName,
          arguments: expectedCall.arguments,
        });

        expect(result).toEqual(expectedCall.result);
      }
    } finally {
      await cleanup();
    }

    expect(client.state).toBe("closed");
  });

  it("lists caesar_cipher_encrypt and word_of_the_day via createTestPair", async () => {
    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);

      expect(result.tools).toHaveLength(2);
      expect(toolNames).toContain("caesar_cipher_encrypt");
      expect(toolNames).toContain("word_of_the_day");
    } finally {
      await cleanup();
    }
  });

  it("returns khoor when calling caesar_cipher_encrypt with text=hello", async () => {
    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "caesar_cipher_encrypt",
        arguments: { text: "hello" },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "khoor" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns the expected text for word_of_the_day", async () => {
    const server = createTestServer();
    const { client, cleanup } = await createTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "word_of_the_day",
        arguments: {},
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "Bumfuzzle - to confuse or fluster someone" }],
      });
    } finally {
      await cleanup();
    }
  });
});
