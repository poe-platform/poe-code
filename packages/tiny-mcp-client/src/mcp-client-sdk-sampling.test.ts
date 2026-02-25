import { describe, expect, it } from "vitest";
import { McpClient, createMockSamplingServer, createSdkTestPair } from "./internal.js";

describe("McpClient SDK integration sampling", () => {
  it("triggers sampling/createMessage during tool call and uses sampled output", async () => {
    const samplingRequests: unknown[] = [];
    const server = await createMockSamplingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onSamplingRequest: async (params) => {
          samplingRequests.push(params);

          return {
            model: "test-model",
            role: "assistant",
            stopReason: "endTurn",
            content: {
              type: "text",
              text: "TypeScript adds types to JavaScript.",
            },
          };
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "sample_message",
        arguments: {
          topic: "TypeScript",
        },
      });

      expect(samplingRequests).toHaveLength(1);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Sampled response: TypeScript adds types to JavaScript.",
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("forwards modelPreferences and systemPrompt in sampling/createMessage", async () => {
    const samplingRequests: unknown[] = [];
    const server = await createMockSamplingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onSamplingRequest: async (params) => {
          samplingRequests.push(params);

          return {
            model: "test-model",
            role: "assistant",
            stopReason: "endTurn",
            content: {
              type: "text",
              text: "Forwarding works.",
            },
          };
        },
      })
    );

    try {
      await client.callTool({
        name: "sample_message",
        arguments: {
          topic: "TypeScript",
        },
      });

      expect(samplingRequests).toHaveLength(1);
      expect(samplingRequests[0]).toMatchObject({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Provide a concise sentence about TypeScript.",
            },
          },
        ],
        maxTokens: 64,
        modelPreferences: {
          hints: [{ name: "mock-sampling-model" }],
          speedPriority: 0.2,
          intelligencePriority: 0.9,
        },
        systemPrompt: "Return exactly one concise sentence.",
      });
    } finally {
      await cleanup();
    }
  });
});
