import type { Readable } from "node:stream";
import { createTestServer } from "tiny-stdio-mcp-test-server";
import { describe, expect, it, vi } from "vitest";
import { type McpTransport, createTestPair, readLines } from "./internal.js";

class FakeClient {
  connectedTransport: McpTransport | undefined;

  readonly connect = vi.fn(async (transport: McpTransport) => {
    this.connectedTransport = transport;
  });

  readonly close = vi.fn(async () => {});
}

async function readSingleLine(stream: Readable): Promise<string> {
  for await (const line of readLines(stream)) {
    return line;
  }

  throw new Error("Stream ended before a line was read");
}

describe("createTestPair", () => {
  it("connects tiny server to in-memory transport and returns cleanup", async () => {
    const server = createTestServer();
    const connectSpy = vi.spyOn(server, "connect");
    const client = new FakeClient();

    const { client: connectedClient, cleanup } = await createTestPair(
      server,
      () => client
    );

    expect(connectedClient).toBe(client);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);

    const serverTransport = connectSpy.mock.calls[0]?.[0];
    if (serverTransport === undefined) {
      throw new Error("Expected server connect transport argument");
    }

    if (client.connectedTransport === undefined) {
      throw new Error("Expected client to receive transport");
    }

    serverTransport.writable.write('{"from":"server"}\n');
    await expect(readSingleLine(client.connectedTransport.readable)).resolves.toBe(
      '{"from":"server"}'
    );

    await cleanup();

    expect(client.close).toHaveBeenCalledTimes(1);
    await expect(client.connectedTransport.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});
