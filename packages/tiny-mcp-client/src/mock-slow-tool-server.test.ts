import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "bun:test";
import { createMockSlowToolServer } from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for cancellation");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("createMockSlowToolServer", () => {
  it("delays the slow tool response by configurable duration", async () => {
    const server = await createMockSlowToolServer({ delayMs: 15, pollIntervalMs: 2 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "slow",
        arguments: {
          delayMs: 15,
        },
      });

      expect(result).toMatchObject({
        content: [{ type: "text", text: "slow complete after 15ms" }],
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("stops processing after notifications/cancelled and records cancellation", async () => {
    const server = await createMockSlowToolServer({ delayMs: 500, pollIntervalMs: 5 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const abortController = new AbortController();
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await client.listTools();

      const callPromise = client.callTool(
        {
          name: "slow",
          arguments: {
            delayMs: 500,
          },
        },
        undefined,
        { signal: abortController.signal }
      );

      await new Promise((resolve) => setTimeout(resolve, 25));
      abortController.abort("test cancellation");

      await expect(callPromise).rejects.toThrow();
      await waitFor(() => server.wasCancelled());
      expect(server.wasCancelled()).toBe(true);
      expect(server.getCancelledRequestIds()).toHaveLength(1);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
