import { describe, expect, it } from "vitest";
import { McpClient, createMockLoggingServer, createSdkTestPair } from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for logging callback notifications");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("McpClient SDK integration logging", () => {
  it("sets logging level and dispatches onLog for matching severities", async () => {
    const receivedLogs: Array<{ level: string; logger?: string; data: unknown }> = [];
    const server = await createMockLoggingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onLog: async (message) => {
          receivedLogs.push(message);
        },
      })
    );

    try {
      await client.setLogLevel("info");

      const callResult = await client.callTool({
        name: "emit_logs",
      });
      expect(callResult).toMatchObject({
        content: [{ type: "text", text: "Emitted log messages." }],
      });

      await waitFor(() => receivedLogs.length >= 2);

      expect(receivedLogs).toEqual([
        {
          level: "info",
          logger: "mock-logging-server",
          data: {
            message: "Info message",
          },
        },
        {
          level: "error",
          logger: "mock-logging-server",
          data: {
            message: "Error message",
          },
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("sets logging level to error and only receives error+ log notifications", async () => {
    const receivedLogs: Array<{ level: string; logger?: string; data: unknown }> = [];
    const server = await createMockLoggingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onLog: async (message) => {
          receivedLogs.push(message);
        },
      })
    );

    try {
      await client.setLogLevel("error");

      const callResult = await client.callTool({
        name: "emit_logs",
      });
      expect(callResult).toMatchObject({
        content: [{ type: "text", text: "Emitted log messages." }],
      });

      await waitFor(() => receivedLogs.length >= 1);
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(receivedLogs).toEqual([
        {
          level: "error",
          logger: "mock-logging-server",
          data: {
            message: "Error message",
          },
        },
      ]);
    } finally {
      await cleanup();
    }
  });
});
