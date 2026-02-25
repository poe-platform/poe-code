import { describe, expect, it } from "vitest";
import { McpClient, createMockMultiToolServer, createSdkTestPair } from "./internal.js";

describe("McpClient integration tools with SDK multi-tool server", () => {
  it("lists add, greet, and fail tools", async () => {
    const server = await createMockMultiToolServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);

      expect(result.tools).toHaveLength(3);
      expect(toolNames).toContain("add");
      expect(toolNames).toContain("greet");
      expect(toolNames).toContain("fail");
    } finally {
      await cleanup();
    }
  });

  it("returns 5 when calling add with a=2 and b=3", async () => {
    const server = await createMockMultiToolServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "add",
        arguments: { a: 2, b: 3 },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "5" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns greeting text when calling greet with name=world", async () => {
    const server = await createMockMultiToolServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "world" },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "Hello, world!" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns isError=true when calling fail", async () => {
    const server = await createMockMultiToolServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "fail",
      });

      expect(result).toEqual({
        isError: true,
        content: [{ type: "text", text: "Intentional tool failure." }],
      });
    } finally {
      await cleanup();
    }
  });
});
