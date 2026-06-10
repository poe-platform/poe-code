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
  callback: () => Promise<T> | T
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
        { name: "review", description: "Review code", arguments: [{ name: "code", required: true }] },
        ({ code }) => ({ messages: [{ role: "user", content: { type: "text", text: `Review ${code}` } }] })
      )
      .resource(
        { uri: "memo://welcome", name: "welcome", mimeType: "text/plain" },
        () => ({ contents: [{ uri: "memo://welcome", mimeType: "text/plain", text: "hello" }] })
      )
      .resourceTemplate(
        { uriTemplate: "memo://{name}", name: "memo", mimeType: "text/plain" },
        (uri) => ({ contents: [{ uri, mimeType: "text/plain", text: uri }] })
      )
      .resourceTemplate(
        { uriTemplate: "search://{?query,limit}", name: "search", mimeType: "text/plain" },
        (uri) => ({ contents: [{ uri, mimeType: "text/plain", text: uri }] })
      );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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
      await expect(pair.client.listPrompts()).resolves.toMatchObject({ prompts: [{ name: "review" }] });
      await expect(pair.client.getPrompt({ name: "review", arguments: { code: "main.ts" } })).resolves.toMatchObject({
        messages: [{ role: "user", content: { type: "text", text: "Review main.ts" } }],
      });
      await expect(pair.client.listResources()).resolves.toMatchObject({ resources: [{ uri: "memo://welcome" }] });
      await expect(pair.client.listResourceTemplates()).resolves.toMatchObject({
        resourceTemplates: [
          { uriTemplate: "memo://{name}" },
          { uriTemplate: "search://{?query,limit}" },
        ],
      });
      await expect(pair.client.readResource({ uri: "memo://welcome" })).resolves.toMatchObject({ contents: [{ text: "hello" }] });
      await expect(pair.client.readResource({ uri: "memo://other" })).resolves.toMatchObject({ contents: [{ text: "memo://other" }] });
      await expect(pair.client.readResource({ uri: "search://?query=mcp&limit=2" })).resolves.toMatchObject({ contents: [{ text: "search://?query=mcp&limit=2" }] });
      await expect(pair.client.readResource({ uri: "other://missing" })).rejects.toMatchObject({ code: -32002 });
    } finally {
      await pair.close();
    }
  });

  it("emits list and subscribed resource update notifications", async () => {
    const pair = await connect();
    const promptChanged = vi.fn();
    const resourceChanged = vi.fn();
    const resourceUpdated = vi.fn();
    pair.client.setNotificationHandler(PromptListChangedNotificationSchema, promptChanged);
    pair.client.setNotificationHandler(ResourceListChangedNotificationSchema, resourceChanged);
    pair.client.setNotificationHandler(ResourceUpdatedNotificationSchema, resourceUpdated);
    try {
      await pair.client.subscribeResource({ uri: "memo://welcome" });
      await pair.server.notifyPromptsChanged();
      await pair.server.notifyResourcesChanged();
      await pair.server.notifyResourceUpdated("memo://welcome");
      await pair.server.notifyResourceUpdated("memo://other");
      expect(promptChanged).toHaveBeenCalledTimes(1);
      expect(resourceChanged).toHaveBeenCalledTimes(1);
      expect(resourceUpdated).toHaveBeenCalledTimes(1);
      expect(resourceUpdated).toHaveBeenCalledWith(expect.objectContaining({ params: { uri: "memo://welcome" } }));
      await pair.client.unsubscribeResource({ uri: "memo://welcome" });
      await pair.server.notifyResourceUpdated("memo://welcome");
      expect(resourceUpdated).toHaveBeenCalledTimes(1);
    } finally {
      await pair.close();
    }
  });

  it("advertises supported prompt and resource APIs with empty registries", async () => {
    const server = createServer({ name: "tools-only", version: "1.0.0" });
    await expect(server.handleMessage("initialize", { protocolVersion: "2025-11-25" })).resolves.toMatchObject({
      result: { capabilities: { prompts: { listChanged: true }, resources: { listChanged: true, subscribe: true } } },
    });
    await expect(server.handleMessage("prompts/list")).resolves.toMatchObject({ result: { prompts: [] } });
    await expect(server.handleMessage("resources/list")).resolves.toMatchObject({ result: { resources: [] } });
  });

  it("returns declarative rich tool descriptors and validated structured content", async () => {
    const server = createServer({ name: "rich-tools", version: "1.0.0" }).registerTool(
      {
        name: "weather",
        title: "Weather",
        description: "Get weather",
        inputSchema: defineSchema({ location: { type: "string" } }),
        outputSchema: defineSchema({ temperature: { type: "number" } }),
        annotations: { readOnlyHint: true },
      },
      () => ({ content: [{ type: "text", text: '{"temperature":22}' }], structuredContent: { temperature: 22 } })
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    await expect(server.handleMessage("tools/list")).resolves.toMatchObject({
      result: { tools: [{ name: "weather", title: "Weather", annotations: { readOnlyHint: true } }] },
    });
    await expect(server.handleMessage("tools/call", { name: "weather", arguments: { location: "Chicago" } })).resolves.toMatchObject({
      result: { structuredContent: { temperature: 22 } },
    });
  });

  it("validates complete JSON Schema constraints for tool inputs and outputs", async () => {
    const server = createServer({ name: "schema-tools", version: "1.0.0" }).registerTool(
      {
        name: "tags",
        inputSchema: {
          type: "object",
          properties: { tags: { type: "array", items: { type: "string" }, minItems: 2 } },
          required: ["tags"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { total: { type: "integer", minimum: 2 } },
          required: ["total"],
        },
      },
      () => ({ content: [], structuredContent: { total: 1 } })
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(server.handleMessage("tools/call", { name: "tags", arguments: { tags: ["one"] } })).resolves.toMatchObject({
      error: { code: -32602 },
    });
    await expect(server.handleMessage("tools/call", { name: "tags", arguments: { tags: ["one", "two"] } })).resolves.toMatchObject({
      result: { isError: true },
    });
  });

  it("accepts object JSON Schemas without a properties keyword", async () => {
    const server = createServer({ name: "schema-minimal", version: "1.0.0" }).registerTool(
      { name: "empty", inputSchema: { type: "object", additionalProperties: false } },
      () => ({ content: [] })
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    await expect(server.handleMessage("tools/call", { name: "empty", arguments: {} })).resolves.toMatchObject({ result: { content: [] } });
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
        () => ({ content: [{ type: "resource_link", uri: "memory://file", name: "file" }] })
      )
      .prompt({ name: "metadata-prompt", icons: [{ src: "https://example.com/prompt.svg" }], _meta: { category: "test" } }, () => ({ messages: [] }))
      .resource({ uri: "memory://file", name: "file", icons: [{ src: "https://example.com/file.svg" }], annotations: { audience: ["user"] }, _meta: { category: "test" } }, () => ({ contents: [{ uri: "memory://file", text: "file" }] }));
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(server.handleMessage("tools/list")).resolves.toMatchObject({ result: { tools: [{ execution: { taskSupport: "forbidden" }, _meta: { category: "test" } }] } });
    await expect(server.handleMessage("prompts/list")).resolves.toMatchObject({ result: { prompts: [{ icons: [{ src: "https://example.com/prompt.svg" }] }] } });
    await expect(server.handleMessage("resources/list")).resolves.toMatchObject({ result: { resources: [{ annotations: { audience: ["user"] } }] } });
    await expect(server.handleMessage("tools/call", { name: "metadata-tool", arguments: {} })).resolves.toMatchObject({ result: { content: [{ type: "resource_link" }] } });
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

    await expect(server.handleMessage("resources/read", { uri: "not a uri" })).resolves.toMatchObject({ error: { code: -32602 } });
    await expect(server.handleMessage("prompts/get", { name: "broken" })).resolves.toMatchObject({ error: { code: -32603, message: "prompt failed" } });
    await expect(server.handleMessage("resources/read", { uri: "memory://broken" })).resolves.toMatchObject({ error: { code: -32603, message: "resource failed" } });
  });

  it("allows unsubscribe after a subscribed resource is removed", async () => {
    const server = createServer({ name: "subscriptions", version: "1.0.0" }).resource(
      { uri: "memory://item", name: "item" },
      () => ({ contents: [{ uri: "memory://item", text: "item" }] })
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    await expect(server.handleMessage("resources/subscribe", { uri: "memory://item" })).resolves.toMatchObject({ result: {} });
    server.removeResource("memory://item");
    await expect(server.handleMessage("resources/unsubscribe", { uri: "memory://item" })).resolves.toMatchObject({ result: {} });
  });

  it("rejects out-of-spec prompt and resource results", async () => {
    const server = createServer({ name: "invalid-results", version: "1.0.0" })
      .prompt({ name: "link" }, () => ({ messages: [{ role: "user", content: { type: "resource_link", uri: "memory://file", name: "file" } as never }] }))
      .resource({ uri: "memory://bad", name: "bad" }, () => ({ contents: [{ uri: "not a uri", text: "bad" }] }));
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(server.handleMessage("prompts/get", { name: "link" })).resolves.toMatchObject({ error: { code: -32603, message: "Invalid prompt result" } });
    await expect(server.handleMessage("resources/read", { uri: "memory://bad" })).resolves.toMatchObject({ error: { code: -32603, message: "Invalid resource result" } });
  });

  it("ignores inherited protocol result containers", async () => {
    const server = createServer({ name: "polluted-results", version: "1.0.0" })
      .registerTool({ name: "tool", inputSchema: defineSchema({}) }, () => ({} as never))
      .prompt({ name: "prompt" }, () => ({} as never))
      .resource({ uri: "memory://item", name: "item" }, () => ({} as never));
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await withObjectPrototypeProperties(
      {
        content: [{ type: "text", text: "polluted tool content" }],
        contents: [{ uri: "memory://item", text: "polluted resource content" }],
        messages: [{ role: "user", content: { type: "text", text: "polluted prompt content" } }],
      },
      async () => {
        await expect(server.handleMessage("tools/call", { name: "tool", arguments: {} })).resolves.toMatchObject({
          result: { content: [{ type: "text", text: "{}" }] },
        });
        await expect(server.handleMessage("prompts/get", { name: "prompt" })).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid prompt result" },
        });
        await expect(server.handleMessage("resources/read", { uri: "memory://item" })).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid resource result" },
        });
      }
    );
  });

  it("rejects inherited nested protocol content fields", async () => {
    const server = createServer({
      name: "polluted-content",
      validateToolArguments: false,
      version: "1.0.0",
    })
      .registerTool({ name: "tool", inputSchema: defineSchema({}) }, () => ({ content: [{}] } as never))
      .prompt({ name: "prompt" }, () => ({ messages: [{}] } as never))
      .resource({ uri: "memory://item", name: "item" }, () => ({ contents: [{}] } as never));
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
        await expect(server.handleMessage("tools/call", { name: "tool", arguments: {} })).resolves.toMatchObject({
          result: {
            content: [{ type: "text", text: "Error: Invalid tool result" }],
            isError: true,
          },
        });
        await expect(server.handleMessage("prompts/get", { name: "prompt" })).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid prompt result" },
        });
        await expect(server.handleMessage("resources/read", { uri: "memory://item" })).resolves.toMatchObject({
          error: { code: -32603, message: "Invalid resource result" },
        });
      }
    );
  });

  it("rejects non-base64 binary protocol content returned by handlers", async () => {
    const server = createServer({ name: "binary", version: "1.0.0" })
      .registerTool({ name: "image", inputSchema: defineSchema({}) }, () => ({ content: [{ type: "image", data: "%%%", mimeType: "image/png" }] }))
      .resource({ uri: "memory://blob", name: "blob" }, () => ({ contents: [{ uri: "memory://blob", blob: "%%%" }] }));
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    await expect(server.handleMessage("tools/call", { name: "image", arguments: {} })).resolves.toMatchObject({ result: { isError: true } });
    await expect(server.handleMessage("resources/read", { uri: "memory://blob" })).resolves.toMatchObject({ error: { code: -32603 } });
  });

  it("does not register malformed URI templates", () => {
    const server = createServer({ name: "template", version: "1.0.0" });
    expect(() => server.resourceTemplate({ uriTemplate: "memory://{unclosed", name: "bad" }, () => ({ contents: [] }))).toThrow();
  });
});
