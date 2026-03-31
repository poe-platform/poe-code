import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "bun:test";
import { createMockSamplingServer } from "./internal.js";

describe("createMockSamplingServer", () => {
  it("calls sampling/createMessage and uses the client response in tool output", async () => {
    const server = await createMockSamplingServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: { sampling: {} } }
    );
    let receivedSamplingParams: unknown;

    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      receivedSamplingParams = request.params;

      return {
        model: "test-model",
        role: "assistant",
        stopReason: "endTurn",
        content: {
          type: "text",
          text: "TypeScript adds types to JavaScript.",
        },
      };
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "sample_message",
        arguments: {
          topic: "TypeScript",
        },
      });

      expect(receivedSamplingParams).toMatchObject({
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
      expect(result).toMatchObject({
        content: [
          {
            type: "text",
            text: "Sampled response: TypeScript adds types to JavaScript.",
          },
        ],
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
