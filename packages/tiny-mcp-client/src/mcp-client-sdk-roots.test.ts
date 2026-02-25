import { describe, expect, it } from "vitest";
import { McpClient, createMockRootsServer, createSdkTestPair } from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for roots/list refresh");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("McpClient SDK integration roots", () => {
  it("serves roots/list during a tool call", async () => {
    const roots = [
      { uri: "file:///workspace", name: "workspace" },
      { uri: "file:///workspace/docs" },
    ];
    let rootsRequestCount = 0;
    const server = await createMockRootsServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onRootsList: async () => {
          rootsRequestCount += 1;
          return roots;
        },
      })
    );

    try {
      const result = await client.callTool({ name: "roots_summary" });

      expect(rootsRequestCount).toBe(1);
      expect(result).toMatchObject({
        content: [
          {
            type: "text",
            text: "Roots: workspace (file:///workspace), file:///workspace/docs",
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("re-requests roots after sendRootsChanged", async () => {
    const rootsVersions = [
      [{ uri: "file:///workspace", name: "workspace" }],
      [
        { uri: "file:///workspace", name: "workspace" },
        { uri: "file:///workspace/docs", name: "docs" },
      ],
    ];
    let rootsRequestCount = 0;
    const server = await createMockRootsServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        capabilities: {
          roots: {
            listChanged: true,
          },
        },
        onRootsList: async () => {
          const nextRoots = rootsVersions[Math.min(rootsRequestCount, rootsVersions.length - 1)];
          rootsRequestCount += 1;
          return nextRoots;
        },
      })
    );

    try {
      const firstCall = await client.callTool({ name: "roots_summary" });
      expect(firstCall).toMatchObject({
        content: [
          {
            type: "text",
            text: "Roots: workspace (file:///workspace)",
          },
        ],
      });
      expect(rootsRequestCount).toBe(1);

      await client.sendRootsChanged();
      await waitFor(() => rootsRequestCount === 2);

      const secondCall = await client.callTool({ name: "roots_summary" });
      expect(secondCall).toMatchObject({
        content: [
          {
            type: "text",
            text: "Roots: workspace (file:///workspace), docs (file:///workspace/docs)",
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });
});
