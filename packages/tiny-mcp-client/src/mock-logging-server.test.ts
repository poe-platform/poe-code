import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createMockLoggingServer } from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for log notifications");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("createMockLoggingServer", () => {
  it("accepts setLevel and emits filtered notifications/message logs from a tool call", async () => {
    const server = await createMockLoggingServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const receivedLogs: Array<{ level: string; logger?: string; data: unknown }> = [];

    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      receivedLogs.push(notification.params);
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.logging).toBeDefined();

      await client.setLoggingLevel("info");

      const result = await client.callTool({
        name: "emit_logs",
      });

      expect(result).toMatchObject({
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
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
