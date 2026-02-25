import { describe, expect, it } from "vitest";
import {
  ERROR_INTERNAL,
  McpClient,
  McpError,
  createMockEchoToolServer,
  createMockErrorServer,
  createMockMultiToolServer,
  createMockSlowToolServer,
  createSdkTestPair,
} from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for slow tool cancellation");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("McpClient SDK integration callTool", () => {
  it("returns text content array for the echo tool", async () => {
    const server = await createMockEchoToolServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "hello from test" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns text content with the sum for the add tool", async () => {
    const server = await createMockMultiToolServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "add",
        arguments: { a: 7, b: 5 },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "12" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns isError=true for tool error results", async () => {
    const server = await createMockErrorServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "is_error",
      });

      expect(result).toEqual({
        isError: true,
        content: [{ type: "text", text: "Intentional isError tool failure." }],
      });
    } finally {
      await cleanup();
    }
  });

  it("cancels an in-flight slow tool call and surfaces abort rejection", async () => {
    const server = await createMockSlowToolServer({ delayMs: 400, pollIntervalMs: 5 });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );
    const abortController = new AbortController();
    const abortReason = "user cancelled slow tool";

    try {
      const callPromise = client.callTool(
        {
          name: "slow",
          arguments: {
            delayMs: 400,
          },
        },
        { signal: abortController.signal }
      );

      await new Promise((resolve) => setTimeout(resolve, 25));
      abortController.abort(abortReason);

      await expect(callPromise).rejects.toBe(abortReason);
      await waitFor(() => server.wasCancelled());
      expect(server.wasCancelled()).toBe(true);
      expect(server.getCancelledRequestIds()).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("rejects with JSON-RPC error code and message for unknown tool names", async () => {
    const server = await createMockErrorServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const callPromise = client.callTool({
        name: "missing_tool",
      });

      await expect(callPromise).rejects.toBeInstanceOf(McpError);
      await expect(callPromise).rejects.toMatchObject({
        code: ERROR_INTERNAL,
        message: "Unknown tool: missing_tool",
      });
    } finally {
      await cleanup();
    }
  });
});
