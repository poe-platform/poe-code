import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createMockRootsServer } from "./internal.js";

describe("createMockRootsServer", () => {
  it("requests roots/list during tool call and uses returned roots in the result", async () => {
    const server = await createMockRootsServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: { roots: {} } }
    );
    let rootsListRequestCount = 0;

    client.setRequestHandler(ListRootsRequestSchema, async () => {
      rootsListRequestCount += 1;

      return {
        roots: [
          {
            uri: "file:///workspace",
            name: "workspace",
          },
          {
            uri: "file:///workspace/docs",
          },
        ],
      };
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "roots_summary",
      });

      expect(rootsListRequestCount).toBe(1);
      expect(result).toMatchObject({
        content: [
          {
            type: "text",
            text: "Roots: workspace (file:///workspace), file:///workspace/docs",
          },
        ],
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
