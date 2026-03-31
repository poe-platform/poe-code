import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "bun:test";
import { createMockEchoToolServer } from "./internal.js";

describe("createMockEchoToolServer", () => {
  it("responds to tools/list with the echo tool schema", async () => {
    const server = await createMockEchoToolServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toMatchObject({
        name: "echo",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
            },
          },
          required: ["message"],
        },
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to tools/call with echoed message text", async () => {
    const server = await createMockEchoToolServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      });

      expect(result).toMatchObject({
        content: [{ type: "text", text: "hello from test" }],
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
