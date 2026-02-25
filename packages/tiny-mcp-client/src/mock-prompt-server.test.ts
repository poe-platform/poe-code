import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createMockPromptServer } from "./internal.js";

describe("createMockPromptServer", () => {
  it("responds to prompts/list with code_review and summarize prompts", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.prompts).toBeDefined();

      const result = await client.listPrompts();
      expect(result.prompts).toHaveLength(2);

      const promptsByName = new Map(result.prompts.map((prompt) => [prompt.name, prompt]));

      expect(promptsByName.get("code_review")).toMatchObject({
        name: "code_review",
        arguments: [
          {
            name: "code",
            required: true,
          },
        ],
      });
      expect(promptsByName.get("summarize")).toMatchObject({
        name: "summarize",
      });
      expect(promptsByName.get("summarize")?.arguments).toBeUndefined();
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to prompts/get with expanded messages from arguments", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.getPrompt({
        name: "code_review",
        arguments: {
          code: "const answer = 42;",
        },
      });

      expect(result).toMatchObject({
        description: "Review code for correctness and maintainability.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please review the following code:\nconst answer = 42;",
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: "I will review the code for potential issues and improvements.",
            },
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

  it("returns invalid params for a nonexistent prompt name", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.getPrompt({
          name: "unknown_prompt",
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("Unknown prompt: unknown_prompt"),
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("returns invalid params when a required prompt argument is missing", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.getPrompt({
          name: "code_review",
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("Missing required prompt argument: code"),
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
