import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMockMultiToolServer } from "./internal.js";

describe("createMockMultiToolServer", () => {
  it("responds to tools/list with add, greet, and fail schemas", async () => {
    const server = await createMockMultiToolServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listTools();
      expect(result.tools).toHaveLength(3);

      const toolsByName = new Map(result.tools.map((tool) => [tool.name, tool]));

      expect(toolsByName.get("add")).toMatchObject({
        name: "add",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "number" },
          },
          required: ["a", "b"],
        },
      });

      expect(toolsByName.get("greet")).toMatchObject({
        name: "greet",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            formal: { type: "boolean" },
          },
          required: ["name"],
        },
      });

      expect(toolsByName.get("fail")).toMatchObject({
        name: "fail",
        inputSchema: {
          type: "object",
          properties: {},
        },
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("allows calling add, greet, and fail tools", async () => {
    const server = await createMockMultiToolServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const addResult = await client.callTool({
        name: "add",
        arguments: { a: 7, b: 5 },
      });
      expect(addResult).toMatchObject({
        content: [{ type: "text", text: "12" }],
      });

      const greetResult = await client.callTool({
        name: "greet",
        arguments: { name: "Ada", formal: true },
      });
      expect(greetResult).toMatchObject({
        content: [{ type: "text", text: "Good day, Ada." }],
      });

      const failResult = await client.callTool({
        name: "fail",
      });
      expect(failResult).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Intentional tool failure." }],
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
