import { describe, expect, it } from "vitest";
import { McpClient, createMockFullFeaturedServer, createSdkTestPair } from "./internal.js";

describe("McpClient SDK integration full-featured lifecycle", () => {
  it("connects, exercises all full-featured capabilities, and closes cleanly", async () => {
    const server = await createMockFullFeaturedServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      expect(client.state).toBe("ready");
      expect(client.serverInfo).toEqual({
        name: "mock-full-featured-server",
        version: "1.0.0",
      });
      expect(client.serverCapabilities).toMatchObject({
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {},
      });

      const toolsResult = await client.listTools();
      expect(toolsResult.tools).toEqual([
        {
          name: "full_featured_ping",
          description: "Returns a text response and emits an info log.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ]);

      const resourcesResult = await client.listResources();
      expect(resourcesResult.resources).toEqual([
        {
          uri: "file:///full-featured.txt",
          name: "full-featured.txt",
          mimeType: "text/plain",
        },
      ]);

      const promptsResult = await client.listPrompts();
      expect(promptsResult.prompts).toEqual([
        {
          name: "full_featured_prompt",
          description: "Returns a short prompt message for a topic.",
          arguments: [
            {
              name: "topic",
              description: "Topic to include in the prompt output.",
              required: false,
            },
          ],
        },
      ]);

      const toolResult = await client.callTool({
        name: "full_featured_ping",
        arguments: {},
      });
      expect(toolResult).toEqual({
        content: [{ type: "text", text: "full_featured_ping ok" }],
      });

      const resourceResult = await client.readResource({
        uri: "file:///full-featured.txt",
      });
      expect(resourceResult).toEqual({
        contents: [
          {
            uri: "file:///full-featured.txt",
            mimeType: "text/plain",
            text: "Mock full-featured resource",
          },
        ],
      });

      const promptResult = await client.getPrompt({
        name: "full_featured_prompt",
        arguments: {
          topic: "beta",
        },
      });
      expect(promptResult).toEqual({
        description: "Mock prompt from full-featured server.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Provide a short summary for beta.",
            },
          },
        ],
      });

      const completionResult = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "full_featured_prompt",
        },
        argument: {
          name: "topic",
          value: "b",
        },
      });
      expect(completionResult).toEqual({
        completion: {
          values: ["beta"],
        },
      });
    } finally {
      await cleanup();
    }

    expect(client.state).toBe("closed");
  });
});
