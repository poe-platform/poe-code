import { describe, expect, it } from "vitest";
import {
  ERROR_INTERNAL,
  McpClient,
  McpError,
  createMockCompletionServer,
  createMockEchoToolServer,
  createMockErrorServer,
  createMockFullFeaturedServer,
  createMockLoggingServer,
  createMockMultiToolServer,
  createMockPaginatedToolsServer,
  createMockProgressServer,
  createMockPromptServer,
  createMockResourceServer,
  createMockRootsServer,
  createMockSamplingServer,
  createMockSlowToolServer,
  createMockSubscribableResourceServer,
  createSdkTestPair,
} from "./internal.js";

const waitFor = async (predicate: () => boolean, message?: string): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error(message ?? "Timed out waiting for predicate");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("McpClient SDK integration ping", () => {
  it("connects to the mock echo server and completes a ping round-trip", async () => {
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
      await expect(client.ping()).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

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

describe("McpClient SDK integration callTool", () => {
  it("returns text content array for the echo tool", async () => {
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
      const result = await client.callTool({
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "hello from test" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns text content with the sum for the add tool", async () => {
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
        arguments: { a: 7, b: 5 },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "12" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("returns isError=true for tool error results", async () => {
    const server = await createMockErrorServer();
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
        name: "is_error",
      });

      expect(result).toEqual({
        isError: true,
        content: [{ type: "text", text: "Intentional isError tool failure." }],
      });
    } finally {
      await cleanup();
    }
  });

  it("cancels an in-flight slow tool call and surfaces abort rejection", async () => {
    const server = await createMockSlowToolServer({ delayMs: 1_000, pollIntervalMs: 5 });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );
    const abortController = new AbortController();
    const abortReason = "user cancelled slow tool";

    try {
      const callPromise = client.callTool(
        {
          name: "slow",
          arguments: {
            delayMs: 50,
          },
        },
        { signal: abortController.signal }
      );

      await waitFor(() => server.wasStarted(), "Timed out waiting for slow tool to start");
      abortController.abort(abortReason);

      await expect(callPromise).rejects.toBe(abortReason);
      await waitFor(() => server.wasCancelled(), "Timed out waiting for slow tool cancellation");
      expect(server.wasCancelled()).toBe(true);
      expect(server.getCancelledRequestIds()).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("cancels an in-flight slow tool call when the request timeout elapses", async () => {
    const server = await createMockSlowToolServer({ delayMs: 1_000, pollIntervalMs: 5 });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        requestTimeoutMs: 100,
      })
    );

    try {
      const callPromise = client.callTool({
        name: "slow",
        arguments: {
          delayMs: 500,
        },
      });

      await waitFor(() => server.wasStarted(), "Timed out waiting for slow tool to start");

      await expect(callPromise).rejects.toThrow(
        'JSON-RPC request "tools/call" timed out after 100ms'
      );
      await waitFor(() => server.wasCancelled(), "Timed out waiting for slow tool cancellation");
      expect(server.getCancelledRequestIds()).toEqual(server.getStartedRequestIds());
    } finally {
      await cleanup();
    }
  });

  it("rejects with JSON-RPC error code and message for unknown tool names", async () => {
    const server = await createMockErrorServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const callPromise = client.callTool({
        name: "missing_tool",
      });

      await expect(callPromise).rejects.toBeInstanceOf(McpError);
      await expect(callPromise).rejects.toMatchObject({
        code: ERROR_INTERNAL,
        message: "Unknown tool: missing_tool",
      });
    } finally {
      await cleanup();
    }
  });
});

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

describe("McpClient SDK integration logging", () => {
  it("sets logging level and dispatches onLog for matching severities", async () => {
    const receivedLogs: Array<{ level: string; logger?: string; data: unknown }> = [];
    const server = await createMockLoggingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onLog: async (message) => {
          receivedLogs.push(message);
        },
      })
    );

    try {
      await client.setLogLevel("info");

      const callResult = await client.callTool({
        name: "emit_logs",
      });
      expect(callResult).toMatchObject({
        content: [{ type: "text", text: "Emitted log messages." }],
      });

      await waitFor(() => receivedLogs.length >= 2, "Timed out waiting for logging callback notifications");

      expect(receivedLogs).toEqual([
        {
          level: "info",
          logger: "mock-logging-server",
          data: {
            message: "Info message",
          },
        },
        {
          level: "error",
          logger: "mock-logging-server",
          data: {
            message: "Error message",
          },
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("sets logging level to error and only receives error+ log notifications", async () => {
    const receivedLogs: Array<{ level: string; logger?: string; data: unknown }> = [];
    const server = await createMockLoggingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onLog: async (message) => {
          receivedLogs.push(message);
        },
      })
    );

    try {
      await client.setLogLevel("error");

      const callResult = await client.callTool({
        name: "emit_logs",
      });
      expect(callResult).toMatchObject({
        content: [{ type: "text", text: "Emitted log messages." }],
      });

      await waitFor(() => receivedLogs.length >= 1, "Timed out waiting for logging callback notifications");
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(receivedLogs).toEqual([
        {
          level: "error",
          logger: "mock-logging-server",
          data: {
            message: "Error message",
          },
        },
      ]);
    } finally {
      await cleanup();
    }
  });
});

describe("McpClient SDK integration resources", () => {
  it("lists resources and reads text resource content", async () => {
    const server = await createMockResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listResources();
      const textResource = listResult.resources.find(
        (resource) => resource.mimeType === "text/plain"
      );

      expect(textResource).toBeDefined();
      if (textResource === undefined) {
        throw new Error("Expected text resource from resources/list");
      }

      const readResult = await client.readResource({ uri: textResource.uri });

      expect(readResult.contents).toEqual([
        {
          uri: "file:///readme.txt",
          mimeType: "text/plain",
          text: "This is a mock README resource.",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("lists resources and reads binary resource blob", async () => {
    const server = await createMockResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listResources();
      const binaryResource = listResult.resources.find(
        (resource) => resource.mimeType === "image/png"
      );

      expect(binaryResource).toBeDefined();
      if (binaryResource === undefined) {
        throw new Error("Expected binary resource from resources/list");
      }

      const readResult = await client.readResource({ uri: binaryResource.uri });

      expect(readResult.contents).toEqual([
        {
          uri: "file:///image.png",
          mimeType: "image/png",
          blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgL9qj3QAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("lists resource templates and exposes uriTemplate", async () => {
    const server = await createMockResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.listResourceTemplates();

      expect(result.resourceTemplates).toEqual([
        {
          uriTemplate: "file:///{path}",
          name: "file-template",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("subscribes to a resource and receives updated notification", async () => {
    const resourceUri = "file:///readme.txt";
    const updatedUris: string[] = [];
    const server = await createMockSubscribableResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onResourceUpdated: async (uri) => {
          updatedUris.push(uri);
        },
      })
    );

    try {
      await client.subscribe(resourceUri);
      await server.triggerResourceUpdated(resourceUri);

      await waitFor(() => updatedUris.includes(resourceUri), "Timed out waiting for resource update notification");
      expect(updatedUris).toEqual([resourceUri]);
    } finally {
      await cleanup();
    }
  });

  it("unsubscribes from a resource and does not receive further updates", async () => {
    const resourceUri = "file:///readme.txt";
    const updatedUris: string[] = [];
    const server = await createMockSubscribableResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onResourceUpdated: async (uri) => {
          updatedUris.push(uri);
        },
      })
    );

    try {
      await client.subscribe(resourceUri);
      await server.triggerResourceUpdated(resourceUri);
      await waitFor(() => updatedUris.length === 1, "Timed out waiting for resource update notification");

      await client.unsubscribe(resourceUri);
      updatedUris.length = 0;

      await server.triggerResourceUpdated(resourceUri);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(updatedUris).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("runs resource subscription lifecycle and receives notifications in order", async () => {
    const resourceUri = "file:///readme.txt";
    const notifications: string[] = [];
    const server = await createMockSubscribableResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onResourcesChanged: async () => {
          notifications.push("notifications/resources/list_changed");
        },
        onResourceUpdated: async (uri) => {
          notifications.push(`notifications/resources/updated:${uri}`);
        },
      })
    );

    try {
      const listResult = await client.listResources();
      expect(listResult.resources).toEqual([
        {
          uri: resourceUri,
          name: "readme.txt",
          mimeType: "text/plain",
        },
      ]);

      await client.subscribe(resourceUri);
      await server.triggerResourceListChanged();
      await server.triggerResourceUpdated(resourceUri, "Updated resource text after subscribe.");
      await waitFor(() => notifications.length === 2, "Timed out waiting for resource update notification");

      const readResult = await client.readResource({ uri: resourceUri });
      expect(readResult.contents).toEqual([
        {
          uri: resourceUri,
          mimeType: "text/plain",
          text: "Updated resource text after subscribe.",
        },
      ]);
      expect(notifications).toEqual([
        "notifications/resources/list_changed",
        `notifications/resources/updated:${resourceUri}`,
      ]);

      await client.unsubscribe(resourceUri);
      await server.triggerResourceUpdated(resourceUri, "Ignored resource text after unsubscribe.");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(notifications).toEqual([
        "notifications/resources/list_changed",
        `notifications/resources/updated:${resourceUri}`,
      ]);
    } finally {
      await cleanup();
    }
  });
});

describe("McpClient SDK integration prompts", () => {
  it("lists prompts and gets code_review with arguments", async () => {
    const server = await createMockPromptServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listPrompts();
      const codeReviewPrompt = listResult.prompts.find(
        (prompt) => prompt.name === "code_review"
      );

      expect(codeReviewPrompt).toMatchObject({
        name: "code_review",
        arguments: [
          {
            name: "code",
            required: true,
          },
        ],
      });

      const getResult = await client.getPrompt({
        name: "code_review",
        arguments: {
          code: "const answer = 42;",
        },
      });

      expect(getResult).toEqual({
        description: "Review code for correctness and maintainability.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please review the following code:\nconst answer = 42;",
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: "I will review the code for potential issues and improvements.",
            },
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("lists prompts and gets summarize without arguments", async () => {
    const server = await createMockPromptServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listPrompts();
      const summarizePrompt = listResult.prompts.find(
        (prompt) => prompt.name === "summarize"
      );

      expect(summarizePrompt).toMatchObject({
        name: "summarize",
        description: "Summarize the provided text.",
      });
      expect(summarizePrompt?.arguments).toBeUndefined();

      const getResult = await client.getPrompt({
        name: "summarize",
      });

      expect(getResult).toEqual({
        description: "Summarize the provided text.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please summarize the provided text.",
            },
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });
});

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
      await waitFor(() => rootsRequestCount === 2, "Timed out waiting for roots/list refresh");

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

describe("McpClient SDK integration sampling", () => {
  it("triggers sampling/createMessage during tool call and uses sampled output", async () => {
    const samplingRequests: unknown[] = [];
    const server = await createMockSamplingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onSamplingRequest: async (params) => {
          samplingRequests.push(params);

          return {
            model: "test-model",
            role: "assistant",
            stopReason: "endTurn",
            content: {
              type: "text",
              text: "TypeScript adds types to JavaScript.",
            },
          };
        },
      })
    );

    try {
      const result = await client.callTool({
        name: "sample_message",
        arguments: {
          topic: "TypeScript",
        },
      });

      expect(samplingRequests).toHaveLength(1);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Sampled response: TypeScript adds types to JavaScript.",
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("forwards modelPreferences and systemPrompt in sampling/createMessage", async () => {
    const samplingRequests: unknown[] = [];
    const server = await createMockSamplingServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onSamplingRequest: async (params) => {
          samplingRequests.push(params);

          return {
            model: "test-model",
            role: "assistant",
            stopReason: "endTurn",
            content: {
              type: "text",
              text: "Forwarding works.",
            },
          };
        },
      })
    );

    try {
      await client.callTool({
        name: "sample_message",
        arguments: {
          topic: "TypeScript",
        },
      });

      expect(samplingRequests).toHaveLength(1);
      expect(samplingRequests[0]).toMatchObject({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Provide a concise sentence about TypeScript.",
            },
          },
        ],
        maxTokens: 64,
        modelPreferences: {
          hints: [{ name: "mock-sampling-model" }],
          speedPriority: 0.2,
          intelligencePriority: 0.9,
        },
        systemPrompt: "Return exactly one concise sentence.",
      });
    } finally {
      await cleanup();
    }
  });
});

describe("McpClient SDK integration completions", () => {
  it("completes a prompt argument and returns matching suggestions", async () => {
    const server = await createMockCompletionServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "code_review",
        },
        argument: {
          name: "language",
          value: "py",
        },
      });

      expect(result).toEqual({
        completion: {
          values: ["python", "pydantic", "pytest"],
          hasMore: true,
          total: 5,
        },
      });
    } finally {
      await cleanup();
    }
  });
});

describe("McpClient SDK integration progress", () => {
  it("calls tool with progressToken, receives progress updates, then receives result", async () => {
    const progressToken = "sdk-progress-1";
    const progressUpdates: Array<{ progressToken: string | number; progress: number }> = [];
    const eventOrder: string[] = [];
    const server = await createMockProgressServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onProgress: async (params) => {
          progressUpdates.push({
            progressToken: params.progressToken,
            progress: params.progress,
          });
          eventOrder.push(`progress:${params.progress}`);
        },
      })
    );

    try {
      const result = await client.callTool(
        {
          name: "slow_task",
        },
        { progressToken }
      );
      eventOrder.push("result");

      expect(result).toEqual({
        content: [{ type: "text", text: "slow_task complete" }],
      });
      expect(progressUpdates).toHaveLength(4);
      expect(progressUpdates.map((update) => update.progressToken)).toEqual([
        progressToken,
        progressToken,
        progressToken,
        progressToken,
      ]);
      expect(eventOrder).toEqual([
        "progress:1",
        "progress:2",
        "progress:3",
        "progress:4",
        "result",
      ]);
    } finally {
      await cleanup();
    }
  });

  it("reports increasing progress values", async () => {
    const progressToken = "sdk-progress-2";
    const observedProgressValues: number[] = [];
    const server = await createMockProgressServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onProgress: async (params) => {
          observedProgressValues.push(params.progress);
        },
      })
    );

    try {
      const result = await client.callTool(
        {
          name: "slow_task",
        },
        { progressToken }
      );

      expect(result).toEqual({
        content: [{ type: "text", text: "slow_task complete" }],
      });
      expect(observedProgressValues).toHaveLength(4);

      for (let index = 1; index < observedProgressValues.length; index += 1) {
        expect(observedProgressValues[index]).toBeGreaterThan(observedProgressValues[index - 1]);
      }
    } finally {
      await cleanup();
    }
  });
});

describe("McpClient SDK integration full-featured lifecycle", () => {
  it("connects, exercises all full-featured capabilities, and closes cleanly", async () => {
    const server = await createMockFullFeaturedServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      expect(client.state).toBe("ready");
      expect(client.serverInfo).toEqual({
        name: "mock-full-featured-server",
        version: "1.0.0",
      });
      expect(client.serverCapabilities).toMatchObject({
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {},
      });

      const toolsResult = await client.listTools();
      expect(toolsResult.tools).toEqual([
        {
          name: "full_featured_ping",
          description: "Returns a text response and emits an info log.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ]);

      const resourcesResult = await client.listResources();
      expect(resourcesResult.resources).toEqual([
        {
          uri: "file:///full-featured.txt",
          name: "full-featured.txt",
          mimeType: "text/plain",
        },
      ]);

      const promptsResult = await client.listPrompts();
      expect(promptsResult.prompts).toEqual([
        {
          name: "full_featured_prompt",
          description: "Returns a short prompt message for a topic.",
          arguments: [
            {
              name: "topic",
              description: "Topic to include in the prompt output.",
              required: false,
            },
          ],
        },
      ]);

      const toolResult = await client.callTool({
        name: "full_featured_ping",
        arguments: {},
      });
      expect(toolResult).toEqual({
        content: [{ type: "text", text: "full_featured_ping ok" }],
      });

      const resourceResult = await client.readResource({
        uri: "file:///full-featured.txt",
      });
      expect(resourceResult).toEqual({
        contents: [
          {
            uri: "file:///full-featured.txt",
            mimeType: "text/plain",
            text: "Mock full-featured resource",
          },
        ],
      });

      const promptResult = await client.getPrompt({
        name: "full_featured_prompt",
        arguments: {
          topic: "beta",
        },
      });
      expect(promptResult).toEqual({
        description: "Mock prompt from full-featured server.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Provide a short summary for beta.",
            },
          },
        ],
      });

      const completionResult = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "full_featured_prompt",
        },
        argument: {
          name: "topic",
          value: "b",
        },
      });
      expect(completionResult).toEqual({
        completion: {
          values: ["beta"],
        },
      });
    } finally {
      await cleanup();
    }

    expect(client.state).toBe("closed");
  });
});
