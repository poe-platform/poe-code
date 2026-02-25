import { describe, expect, it } from "vitest";
import { McpClient, createMockPromptServer, createSdkTestPair } from "./internal.js";

describe("McpClient SDK integration prompts", () => {
  it("lists prompts and gets code_review with arguments", async () => {
    const server = await createMockPromptServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listPrompts();
      const codeReviewPrompt = listResult.prompts.find(
        (prompt) => prompt.name === "code_review"
      );

      expect(codeReviewPrompt).toMatchObject({
        name: "code_review",
        arguments: [
          {
            name: "code",
            required: true,
          },
        ],
      });

      const getResult = await client.getPrompt({
        name: "code_review",
        arguments: {
          code: "const answer = 42;",
        },
      });

      expect(getResult).toEqual({
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
      await cleanup();
    }
  });

  it("lists prompts and gets summarize without arguments", async () => {
    const server = await createMockPromptServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listPrompts();
      const summarizePrompt = listResult.prompts.find(
        (prompt) => prompt.name === "summarize"
      );

      expect(summarizePrompt).toMatchObject({
        name: "summarize",
        description: "Summarize the provided text.",
      });
      expect(summarizePrompt?.arguments).toBeUndefined();

      const getResult = await client.getPrompt({
        name: "summarize",
      });

      expect(getResult).toEqual({
        description: "Summarize the provided text.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please summarize the provided text.",
            },
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });
});
