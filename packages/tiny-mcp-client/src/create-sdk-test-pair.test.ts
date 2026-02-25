import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { describe, expect, it, vi } from "vitest";
import {
  type McpTransport,
  SdkTransportAdapter,
  createSdkTestPair,
} from "./internal.js";

class FakeClient {
  connectedTransport: McpTransport | undefined;

  readonly connect = vi.fn(async (transport: McpTransport) => {
    this.connectedTransport = transport;
  });

  readonly close = vi.fn(async () => {});
}

describe("createSdkTestPair", () => {
  it("connects sdk server to in-memory transport and returns cleanup", async () => {
    const server = new Server({ name: "test-server", version: "1.0.0" });
    const connectSpy = vi.spyOn(server, "connect");
    const client = new FakeClient();

    const { client: connectedClient, cleanup } = await createSdkTestPair(
      server,
      () => client
    );

    expect(connectedClient).toBe(client);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.connectedTransport).toBeInstanceOf(SdkTransportAdapter);

    const serverTransport = connectSpy.mock.calls[0]?.[0];
    if (serverTransport === undefined) {
      throw new Error("Expected server connect transport argument");
    }

    const closeSpy = vi.spyOn(serverTransport, "close");

    await cleanup();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalled();
    await expect(client.connectedTransport?.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});
