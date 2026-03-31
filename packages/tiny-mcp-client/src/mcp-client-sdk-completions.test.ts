import { describe, expect, it } from "bun:test";
import { McpClient, createMockCompletionServer, createSdkTestPair } from "./internal.js";

describe("McpClient SDK integration completions", () => {
  it("completes a prompt argument and returns matching suggestions", async () => {
    const server = await createMockCompletionServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "code_review",
        },
        argument: {
          name: "language",
          value: "py",
        },
      });

      expect(result).toEqual({
        completion: {
          values: ["python", "pydantic", "pytest"],
          hasMore: true,
          total: 5,
        },
      });
    } finally {
      await cleanup();
    }
  });
});
