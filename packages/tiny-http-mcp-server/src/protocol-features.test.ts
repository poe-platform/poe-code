import {
  PromptListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createHttpServer } from "./http-server.js";
import { createHttpTestPair } from "./testing.js";
import { nodeFetch } from "./test-support.js";
import { defineSchema } from "tiny-stdio-mcp-server";

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

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

describe("HTTP prompt and resource SDK interoperability", () => {
  it("exposes prompts and resources through Streamable HTTP", async () => {
    const server = createHttpServer({ name: "http-features", version: "1.0.0" })
      .prompt({ name: "welcome" }, () => ({
        messages: [{ role: "user", content: { type: "text", text: "hello" } }],
      }))
      .resource({ uri: "memory://welcome", name: "welcome" }, () => ({
        contents: [{ uri: "memory://welcome", text: "hello over HTTP" }],
      }));
    const pair = await createHttpTestPair(server);

    try {
      await expect(pair.client.listPrompts()).resolves.toMatchObject({ prompts: [{ name: "welcome" }] });
      await expect(pair.client.getPrompt({ name: "welcome" })).resolves.toMatchObject({
        messages: [{ content: { text: "hello" } }],
      });
      await expect(pair.client.listResources()).resolves.toMatchObject({ resources: [{ uri: "memory://welcome" }] });
      await expect(pair.client.readResource({ uri: "memory://welcome" })).resolves.toMatchObject({
        contents: [{ text: "hello over HTTP" }],
      });
    } finally {
      await pair.cleanup();
    }
  });

  it("delivers only subscribed resource updates over a session SSE stream", async () => {
    const server = createHttpServer({ name: "http-updates", version: "1.0.0" }).resource(
      { uri: "memory://welcome", name: "welcome" },
      () => ({ contents: [{ uri: "memory://welcome", text: "hello" }] })
    );
    const pair = await createHttpTestPair(server);
    const promptChanged = vi.fn();
    const resourceUpdated = vi.fn();
    pair.client.setNotificationHandler(PromptListChangedNotificationSchema, promptChanged);
    pair.client.setNotificationHandler(ResourceUpdatedNotificationSchema, resourceUpdated);

    try {
      await pair.client.subscribeResource({ uri: "memory://welcome" });
      await server.notifyResourceUpdated("memory://welcome");
      await vi.waitFor(() => expect(resourceUpdated).toHaveBeenCalledTimes(1));
      await pair.client.unsubscribeResource({ uri: "memory://welcome" });
      await server.notifyResourceUpdated("memory://welcome");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resourceUpdated).toHaveBeenCalledTimes(1);
      expect(promptChanged).not.toHaveBeenCalled();
    } finally {
      await pair.cleanup();
    }
  });

  it("rejects non-local origins unless explicitly allowed", async () => {
    const server = createHttpServer({ name: "origin", version: "1.0.0" });
    const handle = await server.listenHttp({ port: 0 });
    try {
      const response = await nodeFetch(handle.url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
      });
      expect(response.status).toBe(403);
    } finally {
      await handle.close();
    }
  });

  it("does not advertise subscriptions or list notifications in stateless HTTP mode", async () => {
    const server = createHttpServer({
      name: "stateless",
      version: "1.0.0",
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    }).resource({ uri: "memory://item", name: "item" }, () => ({ contents: [{ uri: "memory://item", text: "item" }] }));
    const pair = await createHttpTestPair(server);
    try {
      expect(pair.client.getServerCapabilities()).toMatchObject({ resources: {}, prompts: {}, tools: {} });
      expect(pair.client.getServerCapabilities()?.resources).not.toHaveProperty("subscribe");
      await expect(pair.client.subscribeResource({ uri: "memory://item" })).rejects.toThrow();
    } finally {
      await pair.cleanup();
    }
  });

  it("ignores inherited HTTP session id generator options", async () => {
    await withObjectPrototypeProperties(
      { sessionIdGenerator: () => "polluted-session" },
      async () => {
        const server = createHttpServer({
          name: "inherited-generator",
          version: "1.0.0",
          enableJsonResponse: true,
        });
        const handle = await server.listenHttp({ port: 0 });

        try {
          const response = await nodeFetch(handle.url, {
            method: "POST",
            headers: {
              Accept: "application/json, text/event-stream",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(INITIALIZE_BODY),
          });

          expect(response.status).toBe(200);
          expect(response.headers.get("mcp-session-id")).toBeTruthy();
          expect(response.headers.get("mcp-session-id")).not.toBe("polluted-session");
        } finally {
          await handle.close();
        }
      }
    );
  });

  it("keeps HTTP sessions enabled when sessionIdGenerator is inherited undefined", async () => {
    await withObjectPrototypeProperties({ sessionIdGenerator: undefined }, async () => {
      const server = createHttpServer({
        name: "inherited-stateless",
        version: "1.0.0",
        enableJsonResponse: true,
      }).resource({ uri: "memory://item", name: "item" }, () => ({
        contents: [{ uri: "memory://item", text: "item" }],
      }));
      const pair = await createHttpTestPair(server);

      try {
        expect(pair.client.getServerCapabilities()).toMatchObject({
          resources: { subscribe: true },
        });
      } finally {
        await pair.cleanup();
      }
    });
  });

  it("preserves request context for rich HTTP tool registration", async () => {
    const server = createHttpServer({ name: "rich-http", version: "1.0.0" }).registerTool(
      { name: "context", inputSchema: defineSchema({}), outputSchema: defineSchema({ present: { type: "boolean" } }) },
      (_args, context) => ({ content: [], structuredContent: { present: context.request !== undefined } })
    );
    const pair = await createHttpTestPair(server);
    try {
      await expect(pair.client.callTool({ name: "context", arguments: {} })).resolves.toMatchObject({
        structuredContent: { present: true },
      });
    } finally {
      await pair.cleanup();
    }
  });
});
