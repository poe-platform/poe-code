import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CreateMessageRequestSchema,
  ErrorCode,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  ProgressNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
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
} from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("createMockCompletionServer", () => {
  it("declares completions capability and filters prompt completions", async () => {
    const server = await createMockCompletionServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.completions).toBeDefined();

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

      expect(result.completion).toEqual({
        values: ["python", "pydantic", "pytest"],
        hasMore: true,
        total: 5,
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

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

describe("createMockFullFeaturedServer", () => {
  it("initializes with all core capabilities and exposes tool/resource/prompt entries", async () => {
    const server = await createMockFullFeaturedServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()).toMatchObject({
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {},
      });

      const toolsResult = await client.listTools();
      const resourcesResult = await client.listResources();
      const promptsResult = await client.listPrompts();

      expect(toolsResult.tools).toHaveLength(1);
      expect(resourcesResult.resources).toHaveLength(1);
      expect(promptsResult.prompts).toHaveLength(1);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

describe("createMockLoggingServer", () => {
  it("accepts setLevel and emits filtered notifications/message logs from a tool call", async () => {
    const server = await createMockLoggingServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const receivedLogs: Array<{ level: string; logger?: string; data: unknown }> = [];

    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      receivedLogs.push(notification.params);
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.logging).toBeDefined();

      await client.setLoggingLevel("info");

      const result = await client.callTool({
        name: "emit_logs",
      });

      expect(result).toMatchObject({
        content: [{ type: "text", text: "Emitted log messages." }],
      });

      await waitFor(() => receivedLogs.length >= 2);

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
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

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

describe("createMockPaginatedToolsServer", () => {
  it("returns 5 tools per page with nextCursor only on non-final pages", async () => {
    const server = await createMockPaginatedToolsServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const firstPage = await client.listTools();
      expect(firstPage.tools).toHaveLength(5);
      expect(firstPage.nextCursor).toBe("5");

      const secondPage = await client.listTools({ cursor: firstPage.nextCursor });
      expect(secondPage.tools).toHaveLength(5);
      expect(secondPage.nextCursor).toBe("10");

      const thirdPage = await client.listTools({ cursor: secondPage.nextCursor });
      expect(thirdPage.tools).toHaveLength(5);
      expect(thirdPage.nextCursor).toBe("15");

      const fourthPage = await client.listTools({ cursor: thirdPage.nextCursor });
      expect(fourthPage.tools).toHaveLength(5);
      expect(fourthPage.nextCursor).toBeUndefined();
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("iterates all pages and collects all 20 tools", async () => {
    const server = await createMockPaginatedToolsServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const collectedNames: string[] = [];
      let cursor: string | undefined;

      do {
        const page =
          cursor === undefined
            ? await client.listTools()
            : await client.listTools({ cursor });
        collectedNames.push(...page.tools.map((tool) => tool.name));
        cursor = page.nextCursor;
      } while (cursor !== undefined);

      expect(collectedNames).toHaveLength(20);
      expect(new Set(collectedNames).size).toBe(20);
      expect(collectedNames[0]).toBe("tool-1");
      expect(collectedNames[19]).toBe("tool-20");
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

describe("createMockProgressServer", () => {
  it("sends 3+ progress notifications for slow_task before returning the final result", async () => {
    const server = await createMockProgressServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const progressUpdates: Array<{
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      progressUpdates.push(notification.params);
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const progressToken = "slow-task-1";
      const result = await client.callTool({
        name: "slow_task",
        _meta: {
          progressToken,
        },
      });

      expect(result).toMatchObject({
        content: [{ type: "text", text: "slow_task complete" }],
      });

      expect(progressUpdates).toHaveLength(4);
      expect(progressUpdates).toEqual([
        {
          progressToken,
          progress: 1,
          total: 4,
          message: "Completed step 1 of 4",
        },
        {
          progressToken,
          progress: 2,
          total: 4,
          message: "Completed step 2 of 4",
        },
        {
          progressToken,
          progress: 3,
          total: 4,
          message: "Completed step 3 of 4",
        },
        {
          progressToken,
          progress: 4,
          total: 4,
          message: "Completed step 4 of 4",
        },
      ]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

describe("createMockPromptServer", () => {
  it("responds to prompts/list with code_review and summarize prompts", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.prompts).toBeDefined();

      const result = await client.listPrompts();
      expect(result.prompts).toHaveLength(2);

      const promptsByName = new Map(result.prompts.map((prompt) => [prompt.name, prompt]));

      expect(promptsByName.get("code_review")).toMatchObject({
        name: "code_review",
        arguments: [
          {
            name: "code",
            required: true,
          },
        ],
      });
      expect(promptsByName.get("summarize")).toMatchObject({
        name: "summarize",
      });
      expect(promptsByName.get("summarize")?.arguments).toBeUndefined();
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to prompts/get with expanded messages from arguments", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.getPrompt({
        name: "code_review",
        arguments: {
          code: "const answer = 42;",
        },
      });

      expect(result).toMatchObject({
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
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("returns invalid params for a nonexistent prompt name", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.getPrompt({
          name: "unknown_prompt",
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("Unknown prompt: unknown_prompt"),
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("returns invalid params when a required prompt argument is missing", async () => {
    const server = await createMockPromptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.getPrompt({
          name: "code_review",
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("Missing required prompt argument: code"),
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

describe("createMockResourceServer", () => {
  it("responds to resources/list with both static resources", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listResources();

      expect(result.resources).toHaveLength(2);

      const resourcesByUri = new Map(result.resources.map((resource) => [resource.uri, resource]));
      expect(resourcesByUri.get("file:///readme.txt")).toMatchObject({
        uri: "file:///readme.txt",
        name: "readme.txt",
        mimeType: "text/plain",
      });
      expect(resourcesByUri.get("file:///image.png")).toMatchObject({
        uri: "file:///image.png",
        name: "image.png",
        mimeType: "image/png",
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to resources/read for text resource", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.readResource({ uri: "file:///readme.txt" });

      expect(result.contents).toEqual([
        {
          uri: "file:///readme.txt",
          mimeType: "text/plain",
          text: "This is a mock README resource.",
        },
      ]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to resources/read for binary resource", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.readResource({ uri: "file:///image.png" });

      expect(result.contents).toEqual([
        {
          uri: "file:///image.png",
          mimeType: "image/png",
          blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgL9qj3QAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to resources/templates/list with file template", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listResourceTemplates();

      expect(result.resourceTemplates).toEqual([
        {
          uriTemplate: "file:///{path}",
          name: "file-template",
        },
      ]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

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

describe("createMockSamplingServer", () => {
  it("calls sampling/createMessage and uses the client response in tool output", async () => {
    const server = await createMockSamplingServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: { sampling: {} } }
    );
    let receivedSamplingParams: unknown;

    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      receivedSamplingParams = request.params;

      return {
        model: "test-model",
        role: "assistant",
        stopReason: "endTurn",
        content: {
          type: "text",
          text: "TypeScript adds types to JavaScript.",
        },
      };
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "sample_message",
        arguments: {
          topic: "TypeScript",
        },
      });

      expect(receivedSamplingParams).toMatchObject({
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
      expect(result).toMatchObject({
        content: [
          {
            type: "text",
            text: "Sampled response: TypeScript adds types to JavaScript.",
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

describe("createMockSlowToolServer", () => {
  it("delays the slow tool response by configurable duration", async () => {
    const server = await createMockSlowToolServer({ delayMs: 15, pollIntervalMs: 2 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "slow",
        arguments: {
          delayMs: 15,
        },
      });

      expect(result).toMatchObject({
        content: [{ type: "text", text: "slow complete after 15ms" }],
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("stops processing after notifications/cancelled and records cancellation", async () => {
    const server = await createMockSlowToolServer({ delayMs: 50, pollIntervalMs: 5 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const abortController = new AbortController();
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await client.listTools();

      const callPromise = client.callTool(
        {
          name: "slow",
          arguments: {
            delayMs: 50,
          },
        },
        undefined,
        { signal: abortController.signal }
      );

      await new Promise((resolve) => setTimeout(resolve, 25));
      abortController.abort("test cancellation");

      await expect(callPromise).rejects.toThrow();
      await waitFor(() => server.wasCancelled());
      expect(server.wasCancelled()).toBe(true);
      expect(server.getCancelledRequestIds()).toHaveLength(1);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});

describe("createMockSubscribableResourceServer", () => {
  it("accepts subscriptions and sends update/list_changed notifications", async () => {
    const server = await createMockSubscribableResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const updatedUris: string[] = [];
    let listChangedCount = 0;

    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
      updatedUris.push(notification.params.uri);
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
      listChangedCount += 1;
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.resources).toMatchObject({
        subscribe: true,
        listChanged: true,
      });

      await client.subscribeResource({ uri: "file:///readme.txt" });

      await server.triggerResourceUpdated("file:///image.png");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(updatedUris).toEqual([]);

      await server.triggerResourceUpdated("file:///readme.txt");
      await waitFor(() => updatedUris.includes("file:///readme.txt"));
      expect(updatedUris).toEqual(["file:///readme.txt"]);

      await server.triggerResourceListChanged();
      await waitFor(() => listChangedCount === 1);
      expect(listChangedCount).toBe(1);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
