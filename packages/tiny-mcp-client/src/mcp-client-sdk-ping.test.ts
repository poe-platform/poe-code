import { describe, expect, it } from "bun:test";
import { McpClient, createMockEchoToolServer, createSdkTestPair } from "./internal.js";

describe("McpClient SDK integration ping", () => {
  it("connects to the mock echo server and completes a ping round-trip", async () => {
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
      await expect(client.ping()).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
