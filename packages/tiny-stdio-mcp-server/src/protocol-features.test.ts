import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./index.js";
import { defineSchema } from "./schema.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T,
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("prompts and resources protocol conformance", () => {
  async function connect() {
    const server = createServer({ name: "features", version: "1.0.0" })
      .prompt(
        {
          name: "review",
          description: "Review code",
          arguments: [{ name: "code", required: true }],
        },
        ({ code }) => ({
          messages: [
            { role: "user", content: { type: "text", text: `Review ${code}` } },
          ],
        }),
      )
      .resource(
        { uri: "memo://welcome", name: "welcome", mimeType: "text/plain" },
        () => ({
          contents: [
            { uri: "memo://welcome", mimeType: "text/plain", text: "hello" },
          ],
        }),
      )
      .resourceTemplate(
        { uriTemplate: "memo://{name}", name: "memo", mimeType: "text/plain" },
        (uri) => ({ contents: [{ uri, mimeType: "text/plain", text: uri }] }),
      )
      .resourceTemplate(
        {
          uriTemplate: "search://{?query,limit}",
          name: "search",
          mimeType: "text/plain",
        },
        (uri) => ({ contents: [{ uri, mimeType: "text/plain", text: uri }] }),
      );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const serverClosed = server.connectSDK(serverTransport);
    await client.connect(clientTransport);
    return {
      client,
      server,
      close: async () => {
        await client.close();
        await serverClosed;
      },
    };
  }

  it("advertises, lists, gets, and reads registered server features", async () => {
    const pair = await connect();
    try {
      expect(pair.client.getServerCapabilities()).toMatchObject({
        prompts: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
      });
      await expect(pair.client.listPrompts()).resolves.toMatchObject({
        prompts: [{ name: "review" }],
      });
      await expect(
        pair.client.getPrompt({
          name: "review",
          arguments: { code: "main.ts" },
        }),
      ).resolves.toMatchObject({
        messages: [
          { role: "user", content: { type: "text", text: "Review main.ts" } },
        ],
      });
      await expect(pair.client.listResources()).resolves.toMatchObject({
        resources: [{ uri: "memo://welcome" }],
      });
      await expect(pair.client.listResourceTemplates()).resolves.toMatchObject({
        resourceTemplates: [
          { uriTemplate: "memo://{name}" },
          { uriTemplate: "search://{?query,limit}" },
        ],
      });
      await expect(
        pair.client.readResource({ uri: "memo://welcome" }),
      ).resolves.toMatchObject({
        contents: [{ text: "hello" }],
      });
      await expect(
        pair.client.readResource({ uri: "memo://other" }),
      ).resolves.toMatchObject({
        contents: [{ text: "memo://other" }],
      });
      await expect(
        pair.client.readResource({ uri: "search://?query=mcp&limit=2" }),
      ).resolves.toMatchObject({
        contents: [{ text: "search://?query=mcp&limit=2" }],
      });
      await expect(
        pair.client.readResource({ uri: "other://missing" }),
      ).rejects.toMatchObject({
        code: -32002,
      });
    } finally {
      await pair.close();
    }
  });

  it("emits list and subscribed resource update notifications", async () => {
    const pair = await connect();
    const promptChanged = vi.fn();
    const resourceChanged = vi.fn();
    const resourceUpdated = vi.fn();
    pair.client.setNotificationHandler(
      PromptListChangedNotificationSchema,
      promptChanged,
    );
    pair.client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      resourceChanged,
    );
    pair.client.setNotificationHandler(
      ResourceUpdatedNotificationSchema,
      resourceUpdated,
    );
    try {
      await pair.client.subscribeResource({ uri: "memo://welcome" });
      await pair.server.notifyPromptsChanged();
      await pair.server.notifyResourcesChanged();
      await pair.server.notifyResourceUpdated("memo://welcome");
      await pair.server.notifyResourceUpdated("memo://other");
      expect(promptChanged).toHaveBeenCalledTimes(1);
      expect(resourceChanged).toHaveBeenCalledTimes(1);
      expect(resourceUpdated).toHaveBeenCalledTimes(1);
      expect(resourceUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ params: { uri: "memo://welcome" } }),
      );
      await pair.client.unsubscribeResource({ uri: "memo://welcome" });
      await pair.server.notifyResourceUpdated("memo://welcome");
      expect(resourceUpdated).toHaveBeenCalledTimes(1);
    } finally {
      await pair.close();
    }
  });

  it("advertises supported prompt and resource APIs with empty registries", async () => {
    const server = createServer({ name: "tools-only", version: "1.0.0" });
    await expect(
      server.handleMessage("initialize", { protocolVersion: "2025-11-25" }),
    ).resolves.toMatchObject({
      result: {
        capabilities: {
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
        },
      },
    });
    await expect(server.handleMessage("prompts/list")).resolves.toMatchObject({
      result: { prompts: [] },
    });
    await expect(server.handleMessage("resources/list")).resolves.toMatchObject(
      {
        result: { resources: [] },
      },
    );
  });

  it("returns declarative rich tool descriptors and validated structured content", async () => {
    const server = createServer({
      name: "rich-tools",
      version: "1.0.0",
    }).registerTool(
      {
        name: "weather",
        title: "Weather",
        description: "Get weather",
        inputSchema: defineSchema({ location: { type: "string" } }),
        outputSchema: defineSchema({ temperature: { type: "number" } }),
        annotations: { readOnlyHint: true },
      },
      () => ({
        content: [{ type: "text", text: '{"temperature":22}' }],
        structuredContent: { temperature: 22 },
      }),
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    await expect(server.handleMessage("tools/list")).resolves.toMatchObject({
      result: {
        tools: [
          {
            name: "weather",
            title: "Weather",
            annotations: { readOnlyHint: true },
          },
        ],
      },
    });
    await expect(
      server.handleMessage("tools/call", {
        name: "weather",
        arguments: { location: "Chicago" },
      }),
    ).resolves.toMatchObject({
      result: { structuredContent: { temperature: 22 } },
    });
  });

  it("emits structured content and JSON text fallback for typed plain object tool returns", async () => {
    const outputSchema = {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              score: { type: "number" },
            },
            required: ["id", "score"],
            additionalProperties: false,
          },
        },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      required: ["items", "metadata"],
      additionalProperties: false,
    };
    const server = createServer({ name: "typed-tools", version: "1.0.0" }).tool(
      "search",
      "Search",
      defineSchema({}),
      () => ({
        items: [{ id: "a", score: 1 }],
        metadata: { source: "fixture" },
      }),
      outputSchema,
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(server.handleMessage("tools/list")).resolves.toMatchObject({
      result: { tools: [{ name: "search", outputSchema }] },
    });
    const response = await server.handleMessage("tools/call", {
      name: "search",
      arguments: {},
    });

    expect(response).toMatchObject({
      result: {
        structuredContent: {
          items: [{ id: "a", score: 1 }],
          metadata: { source: "fixture" },
        },
      },
    });
    expect(
      JSON.parse(
        (response.result as { content: Array<{ text: string }> }).content[0]!
          .text,
      ),
    ).toEqual({
      items: [{ id: "a", score: 1 }],
      metadata: { source: "fixture" },
    });
  });

  it("validates complete JSON Schema constraints for tool inputs and outputs", async () => {
    const server = createServer({
      name: "schema-tools",
      version: "1.0.0",
    }).registerTool(
      {
        name: "tags",
        inputSchema: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" }, minItems: 2 },
          },
          required: ["tags"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { total: { type: "integer", minimum: 2 } },
          required: ["total"],
        },
      },
      () => ({ content: [], structuredContent: { total: 1 } }),
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(
      server.handleMessage("tools/call", {
        name: "tags",
        arguments: { tags: ["one"] },
      }),
    ).resolves.toMatchObject({
      error: {
        code: -32602,
        message: expect.stringContaining("must NOT have fewer than 2 items"),
        data: [expect.objectContaining({ keyword: "minItems" })],
      },
    });
    await expect(
      server.handleMessage("tools/call", {
        name: "tags",
        arguments: { tags: ["one", "two"] },
      }),
    ).resolves.toMatchObject({
      error: {
        code: -32603,
        message: expect.stringContaining("must be >= 2"),
        data: [expect.objectContaining({ keyword: "minimum" })],
      },
    });
  });

  it("rejects non-object output schemas at registration time", () => {
    expect(() =>
      createServer({ name: "bad-schema", version: "1.0.0" }).registerTool(
        {
          name: "bad",
          inputSchema: defineSchema({}),
          outputSchema: { type: "array" } as never,
        },
        () => [],
      ),
    ).toThrow('outputSchema root type must be "object"');
  });

  it("registers and validates spec-legal union, enum, nullable, and referenced schemas", async () => {
    const outputSchema = {
      type: "object" as const,
      $defs: {
        label: { type: "string", enum: ["primary", "secondary"] },
      },
      properties: {
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
        label: { $ref: "#/$defs/label" },
        note: { type: ["string", "null"] },
      },
      required: ["value", "label", "note"],
      additionalProperties: false,
    };
    const server = createServer({
      name: "schema-features",
      version: "1.0.0",
    }).registerTool(
      {
        name: "schema-features",
        inputSchema: {
          type: "object",
          properties: {
            value: { anyOf: [{ type: "string" }, { type: "number" }] },
            label: { enum: ["primary", "secondary"] },
            note: { type: ["string", "null"] },
          },
          required: ["value", "label", "note"],
          additionalProperties: false,
        },
        outputSchema,
      },
      ({ value, label, note }) => ({ value, label, note }),
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-06-18" });

    await expect(server.handleMessage("tools/list")).resolves.toMatchObject({
      result: { tools: [{ name: "schema-features", outputSchema }] },
    });
    await expect(
      server.handleMessage("tools/call", {
        name: "schema-features",
        arguments: { value: 3, label: "primary", note: null },
      }),
    ).resolves.toMatchObject({
      result: { structuredContent: { value: 3, label: "primary", note: null } },
    });
    await expect(
      server.handleMessage("tools/call", {
        name: "schema-features",
        arguments: { value: false, label: "other", note: null },
      }),
    ).resolves.toMatchObject({ error: { code: -32602 } });
  });

  it("registers and validates composed and conditional schemas", async () => {
    const schema = {
      type: "object" as const,
      properties: {
        kind: { enum: ["counted", "named"] },
        count: { type: "integer" },
        name: { type: "string" },
      },
      required: ["kind"],
      allOf: [
        {
          not: {
            required: ["count", "name"],
          },
        },
      ],
      if: {
        properties: { kind: { const: "counted" } },
        required: ["kind"],
      },
      then: { required: ["count"] },
      else: { required: ["name"] },
      additionalProperties: false,
    };
    const server = createServer({
      name: "composed-schemas",
      version: "1.0.0",
    }).registerTool(
      { name: "compose", inputSchema: schema, outputSchema: schema },
      (args) => args,
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-06-18" });

    await expect(
      server.handleMessage("tools/call", {
        name: "compose",
        arguments: { kind: "counted", count: 2 },
      }),
    ).resolves.toMatchObject({
      result: { structuredContent: { kind: "counted", count: 2 } },
    });
    await expect(
      server.handleMessage("tools/call", {
        name: "compose",
        arguments: { kind: "counted", name: "wrong branch" },
      }),
    ).resolves.toMatchObject({
      error: {
        code: -32602,
        message: expect.stringContaining("must have required property 'count'"),
      },
    });
  });

  it("compiles input and output schemas synchronously during registration", () => {
    const server = createServer({ name: "malformed-schema", version: "1.0.0" });

    expect(() =>
      server.tool(
        "bad-tool-input",
        "Malformed input schema",
        { type: "not-a-type" } as never,
        () => "unused",
      ),
    ).toThrow(/schema is invalid.*type/i);
    expect(() =>
      server.tool(
        "bad-tool-output",
        "Malformed output schema",
        defineSchema({}),
        () => ({ value: "unused" }),
        {
          type: "object",
          properties: { value: { type: "not-a-type" } },
        } as never,
      ),
    ).toThrow(/schema is invalid.*type/i);
    expect(() =>
      server.registerTool(
        { name: "bad-input", inputSchema: { type: "not-a-type" } },
        () => "unused",
      ),
    ).toThrow(/schema is invalid.*type/i);
    expect(() =>
      server.registerTool(
        {
          name: "bad-output",
          inputSchema: defineSchema({}),
          outputSchema: {
            type: "object",
            properties: { value: { type: "not-a-type" } },
          },
        },
        () => ({ value: "unused" }),
      ),
    ).toThrow(/schema is invalid.*type/i);
  });

  it("passes explicit error results through without structured output validation", async () => {
    const result = {
      content: [],
      structuredContent: { value: 42 },
      isError: true,
    };
    const server = createServer({
      name: "tool-errors",
      version: "1.0.0",
    }).registerTool(
      {
        name: "failure",
        inputSchema: defineSchema({}),
        outputSchema: defineSchema({ value: { type: "string" } }),
      },
      () => result,
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-06-18" });

    await expect(
      server.handleMessage("tools/call", { name: "failure", arguments: {} }),
    ).resolves.toEqual({ result });
  });

  it("preserves supplied content alongside structured content", async () => {
    const server = createServer({
      name: "tool-content",
      version: "1.0.0",
    }).registerTool(
      {
        name: "content",
        inputSchema: defineSchema({}),
        outputSchema: defineSchema({ value: { type: "string" } }),
      },
      () => ({
        content: [{ type: "text", text: "human-readable" }],
        structuredContent: { value: "machine-readable" },
      }),
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-06-18" });

    await expect(
      server.handleMessage("tools/call", { name: "content", arguments: {} }),
    ).resolves.toEqual({
      result: {
        content: [{ type: "text", text: "human-readable" }],
        structuredContent: { value: "machine-readable" },
      },
    });
  });

  it("accepts object JSON Schemas without a properties keyword", async () => {
    const server = createServer({
      name: "schema-minimal",
      version: "1.0.0",
    }).registerTool(
      {
        name: "empty",
        inputSchema: { type: "object", additionalProperties: false },
      },
      () => ({ content: [] }),
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    await expect(
      server.handleMessage("tools/call", { name: "empty", arguments: {} }),
    ).resolves.toMatchObject({ result: { content: [] } });
  });

  it("rejects malformed call tool result envelopes from handlers", async () => {
    const server = createServer({
      name: "bad-envelope",
      version: "1.0.0",
    }).registerTool(
      { name: "bad", inputSchema: defineSchema({}) },
      () => ({ content: [], structuredContent: "not an object" }) as never,
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(
      server.handleMessage("tools/call", { name: "bad", arguments: {} }),
    ).resolves.toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: "Error: Invalid tool result" }],
      },
    });
  });

  it("rejects empty tool and prompt names at registration", () => {
    const server = createServer({ name: "empty-names", version: "1.0.0" });

    expect(() =>
      server.tool("", "Empty-name tool", defineSchema({}), () => "called"),
    ).toThrow("Tool name required");
    expect(() =>
      server.registerTool(
        { name: "", inputSchema: defineSchema({}) },
        () => "called",
      ),
    ).toThrow("Tool name required");
    expect(() => server.prompt({ name: "" }, () => ({ messages: [] }))).toThrow(
      "Prompt name required",
    );
  });

  it("rejects invalid tool content metadata and resource URIs", async () => {
    const server = createServer({
      name: "invalid-tool-content",
      version: "1.0.0",
    })
      .registerTool(
        { name: "bad-annotations", inputSchema: defineSchema({}) },
        () =>
          ({
            content: [
              {
                type: "text",
                text: "hello",
                annotations: {
                  audience: ["invalid"],
                  priority: "high",
                  lastModified: 123,
                },
              },
            ],
          }) as never,
      )
      .registerTool(
        { name: "bad-resource-link", inputSchema: defineSchema({}) },
        () =>
          ({
            content: [
              { type: "resource_link", uri: "not a uri", name: "Broken link" },
            ],
          }) as never,
      )
      .registerTool(
        { name: "bad-resource", inputSchema: defineSchema({}) },
        () =>
          ({
            content: [
              {
                type: "resource",
                resource: {
                  uri: "not a uri",
                  mimeType: "text/plain",
                  text: "hello",
                },
              },
            ],
          }) as never,
      )
      .registerTool(
        { name: "bad-raw-image", inputSchema: defineSchema({}) },
        () =>
          ({
            type: "image",
            data: "not base64!",
            mimeType: "image/png",
          }) as never,
      );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    for (const name of [
      "bad-annotations",
      "bad-resource-link",
      "bad-resource",
      "bad-raw-image",
    ]) {
      await expect(
        server.handleMessage("tools/call", { name, arguments: {} }),
      ).resolves.toMatchObject({
        result: {
          content: [{ type: "text", text: "Error: Invalid tool result" }],
          isError: true,
        },
      });
    }
  });

  it("rejects invalid prompt metadata and resource mime types", async () => {
    const server = createServer({
      name: "invalid-prompt-resource",
      version: "1.0.0",
    })
      .prompt(
        { name: "bad-prompt" },
        () =>
          ({
            description: 123,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "hello",
                  annotations: { audience: ["invalid"], priority: "high" },
                },
              },
            ],
          }) as never,
      )
      .resource(
        { uri: "memo://bad", name: "bad" },
        () =>
          ({
            contents: [{ uri: "memo://bad", mimeType: 123, text: "hello" }],
          }) as never,
      );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(
      server.handleMessage("prompts/get", { name: "bad-prompt" }),
    ).resolves.toMatchObject({
      error: { code: -32603, message: "Invalid prompt result" },
    });
    await expect(
      server.handleMessage("resources/read", { uri: "memo://bad" }),
    ).resolves.toMatchObject({
      error: { code: -32603, message: "Invalid resource result" },
    });
  });

  it("preserves protocol metadata on tools, prompts, and resources", async () => {
    const server = createServer({ name: "metadata", version: "1.0.0" })
      .registerTool(
        {
          name: "metadata-tool",
          inputSchema: defineSchema({}),
          icons: [{ src: "https://example.com/tool.svg", theme: "dark" }],
          execution: { taskSupport: "forbidden" },
          _meta: { category: "test" },
        },
        () => ({
          content: [
            { type: "resource_link", uri: "memory://file", name: "file" },
          ],
        }),
      )
      .prompt(
        {
          name: "metadata-prompt",
          icons: [{ src: "https://example.com/prompt.svg" }],
          _meta: { category: "test" },
        },
        () => ({ messages: [] }),
      )
      .resource(
        {
          uri: "memory://file",
          name: "file",
          icons: [{ src: "https://example.com/file.svg" }],
          annotations: { audience: ["user"] },
          _meta: { category: "test" },
        },
        () => ({ contents: [{ uri: "memory://file", text: "file" }] }),
      );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(server.handleMessage("tools/list")).resolves.toMatchObject({
      result: {
        tools: [
          {
            execution: { taskSupport: "forbidden" },
            _meta: { category: "test" },
          },
        ],
      },
    });
    await expect(server.handleMessage("prompts/list")).resolves.toMatchObject({
      result: {
        prompts: [{ icons: [{ src: "https://example.com/prompt.svg" }] }],
      },
    });
    await expect(server.handleMessage("resources/list")).resolves.toMatchObject(
      {
        result: { resources: [{ annotations: { audience: ["user"] } }] },
      },
    );
    await expect(
      server.handleMessage("tools/call", {
        name: "metadata-tool",
        arguments: {},
      }),
    ).resolves.toMatchObject({
      result: { content: [{ type: "resource_link" }] },
    });
  });

  it("rejects invalid resource URIs and reports feature handler failures as JSON-RPC errors", async () => {
    const server = createServer({ name: "errors", version: "1.0.0" })
      .prompt({ name: "broken" }, () => {
        throw new Error("prompt failed");
      })
      .resource({ uri: "memory://broken", name: "broken" }, () => {
        throw new Error("resource failed");
      });
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(
      server.handleMessage("resources/read", { uri: "not a uri" }),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    await expect(
      server.handleMessage("prompts/get", { name: "broken" }),
    ).resolves.toMatchObject({
      error: { code: -32603, message: "prompt failed" },
    });
    await expect(
      server.handleMessage("resources/read", { uri: "memory://broken" }),
    ).resolves.toMatchObject({
      error: { code: -32603, message: "resource failed" },
    });
  });

  it("allows unsubscribe after a subscribed resource is removed", async () => {
    const server = createServer({
      name: "subscriptions",
      version: "1.0.0",
    }).resource({ uri: "memory://item", name: "item" }, () => ({
      contents: [{ uri: "memory://item", text: "item" }],
    }));
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    await expect(
      server.handleMessage("resources/subscribe", { uri: "memory://item" }),
    ).resolves.toMatchObject({ result: {} });
    server.removeResource("memory://item");
    await expect(
      server.handleMessage("resources/unsubscribe", { uri: "memory://item" }),
    ).resolves.toMatchObject({ result: {} });
  });

  it("rejects out-of-spec prompt and resource results", async () => {
    const server = createServer({ name: "invalid-results", version: "1.0.0" })
      .prompt({ name: "link" }, () => ({
        messages: [
          {
            role: "user",
            content: {
              type: "resource_link",
              uri: "memory://file",
              name: "file",
            } as never,
          },
        ],
      }))
      .resource({ uri: "memory://bad", name: "bad" }, () => ({
        contents: [{ uri: "not a uri", text: "bad" }],
      }));
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(
      server.handleMessage("prompts/get", { name: "link" }),
    ).resolves.toMatchObject({
      error: { code: -32603, message: "Invalid prompt result" },
    });
    await expect(
      server.handleMessage("resources/read", { uri: "memory://bad" }),
    ).resolves.toMatchObject({
      error: { code: -32603, message: "Invalid resource result" },
    });
  });

  it("ignores inherited protocol result containers", async () => {
    const server = createServer({ name: "polluted-results", version: "1.0.0" })
      .registerTool(
        { name: "tool", inputSchema: defineSchema({}) },
        () => ({}) as never,
      )
      .prompt({ name: "prompt" }, () => ({}) as never)
      .resource({ uri: "memory://item", name: "item" }, () => ({}) as never);
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await withObjectPrototypeProperties(
      {
        content: [{ type: "text", text: "polluted tool content" }],
        contents: [{ uri: "memory://item", text: "polluted resource content" }],
        messages: [
          {
            role: "user",
            content: { type: "text", text: "polluted prompt content" },
          },
        ],
      },
      async () => {
        await expect(
          server.handleMessage("tools/call", { name: "tool", arguments: {} }),
        ).resolves.toMatchObject({
          result: { content: [{ type: "text", text: "{}" }] },
        });
        await expect(
          server.handleMessage("prompts/get", { name: "prompt" }),
        ).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid prompt result" },
        });
        await expect(
          server.handleMessage("resources/read", { uri: "memory://item" }),
        ).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid resource result" },
        });
      },
    );
  });

  it("rejects inherited nested protocol content fields", async () => {
    const server = createServer({
      name: "polluted-content",
      validateToolArguments: false,
      version: "1.0.0",
    })
      .registerTool(
        { name: "tool", inputSchema: defineSchema({}) },
        () => ({ content: [{}] }) as never,
      )
      .prompt({ name: "prompt" }, () => ({ messages: [{}] }) as never)
      .resource(
        { uri: "memory://item", name: "item" },
        () => ({ contents: [{}] }) as never,
      );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await withObjectPrototypeProperties(
      {
        content: { type: "text", text: "polluted prompt content" },
        role: "user",
        text: "polluted text",
        type: "text",
        uri: "memory://item",
      },
      async () => {
        await expect(
          server.handleMessage("tools/call", { name: "tool", arguments: {} }),
        ).resolves.toMatchObject({
          result: {
            content: [{ type: "text", text: "Error: Invalid tool result" }],
            isError: true,
          },
        });
        await expect(
          server.handleMessage("prompts/get", { name: "prompt" }),
        ).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid prompt result" },
        });
        await expect(
          server.handleMessage("resources/read", { uri: "memory://item" }),
        ).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid resource result" },
        });
      },
    );
  });

  it("rejects non-base64 binary protocol content returned by handlers", async () => {
    const server = createServer({ name: "binary", version: "1.0.0" })
      .registerTool({ name: "image", inputSchema: defineSchema({}) }, () => ({
        content: [{ type: "image", data: "%%%", mimeType: "image/png" }],
      }))
      .resource({ uri: "memory://blob", name: "blob" }, () => ({
        contents: [{ uri: "memory://blob", blob: "%%%" }],
      }));
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(
      server.handleMessage("tools/call", { name: "image", arguments: {} }),
    ).resolves.toMatchObject({ result: { isError: true } });
    await expect(
      server.handleMessage("resources/read", { uri: "memory://blob" }),
    ).resolves.toMatchObject({ error: { code: -32603 } });
  });

  it("does not register malformed URI templates", () => {
    const server = createServer({ name: "template", version: "1.0.0" });
    expect(() =>
      server.resourceTemplate(
        { uriTemplate: "memory://{unclosed", name: "bad" },
        () => ({
          contents: [],
        }),
      ),
    ).toThrow();
  });

  it("does not register URI templates that cannot expand to readable URIs", () => {
    const server = createServer({ name: "template-uri", version: "1.0.0" });

    expect(() =>
      server.resourceTemplate(
        { uriTemplate: "not-a-uri/{id}", name: "bad" },
        () => ({
          contents: [],
        }),
      ),
    ).toThrow("Invalid resource URI template");
    expect(() =>
      server.resourceTemplate({ uriTemplate: "", name: "empty" }, () => ({
        contents: [],
      })),
    ).toThrow("Invalid resource URI template");
  });
});
