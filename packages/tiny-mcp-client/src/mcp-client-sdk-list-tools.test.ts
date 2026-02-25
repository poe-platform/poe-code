import { describe, expect, it } from "vitest";
import {
  McpClient,
  createMockEchoToolServer,
  createMockPaginatedToolsServer,
  createSdkTestPair,
} from "./internal.js";

describe("McpClient SDK integration listTools", () => {
  it("lists tools from the mock echo server", async () => {
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
      expect(result.nextCursor).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("returns first tools page with nextCursor when called without cursor", async () => {
    const server = await createMockPaginatedToolsServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const firstPage = await client.listTools();

      expect(firstPage.tools.map((tool) => tool.name)).toEqual([
        "tool-1",
        "tool-2",
        "tool-3",
        "tool-4",
        "tool-5",
      ]);
      expect(firstPage.nextCursor).toBe("5");
    } finally {
      await cleanup();
    }
  });

  it("returns the next tools page when called with nextCursor", async () => {
    const server = await createMockPaginatedToolsServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const firstPage = await client.listTools();
      if (firstPage.nextCursor === undefined) {
        throw new Error("Expected nextCursor on first tools page");
      }

      const secondPage = await client.listTools({ cursor: firstPage.nextCursor });

      expect(secondPage.tools.map((tool) => tool.name)).toEqual([
        "tool-6",
        "tool-7",
        "tool-8",
        "tool-9",
        "tool-10",
      ]);
      expect(secondPage.nextCursor).toBe("10");
    } finally {
      await cleanup();
    }
  });

  it("iterates all pages and collects all tools", async () => {
    const server = await createMockPaginatedToolsServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const collectedToolNames: string[] = [];
      let cursor: string | undefined;

      do {
        const page =
          cursor === undefined
            ? await client.listTools()
            : await client.listTools({ cursor });
        collectedToolNames.push(...page.tools.map((tool) => tool.name));
        cursor = page.nextCursor;
      } while (cursor !== undefined);

      expect(collectedToolNames).toHaveLength(20);
      expect(collectedToolNames).toEqual(
        Array.from({ length: 20 }, (_, index) => `tool-${index + 1}`)
      );
    } finally {
      await cleanup();
    }
  });
});
