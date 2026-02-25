import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createMockErrorServer } from "./internal.js";

describe("createMockErrorServer", () => {
  it("responds to tools/list with tools for invalid params, isError, and internal error", async () => {
    const server = await createMockErrorServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listTools();
      expect(result.tools).toHaveLength(3);

      const toolNames = result.tools.map((tool) => tool.name).sort();
      expect(toolNames).toEqual(["internal_error", "invalid_params", "is_error"]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("returns each error type from its corresponding tool", async () => {
    const server = await createMockErrorServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.callTool({
          name: "invalid_params",
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("Intentional invalid params error"),
      });

      const toolErrorResult = await client.callTool({
        name: "is_error",
      });
      expect(toolErrorResult).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Intentional isError tool failure." }],
      });

      await expect(
        client.callTool({
          name: "internal_error",
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InternalError,
        message: expect.stringContaining("Intentional internal error"),
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
