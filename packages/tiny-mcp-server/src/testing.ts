import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "./server.js";
import type { SDKTransport } from "./types.js";

export interface TestPair {
  client: Client;
  cleanup: () => Promise<void>;
}

export async function createTestPair(server: Server): Promise<TestPair> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({
    name: "test-client",
    version: "1.0.0",
  });

  // Start server connection (runs in background)
  const serverPromise = server.connectSDK(serverTransport as unknown as SDKTransport);

  // Connect client
  await client.connect(clientTransport);

  const cleanup = async () => {
    await client.close();
    await clientTransport.close();
    await serverTransport.close();
    await serverPromise;
  };

  return { client, cleanup };
}
