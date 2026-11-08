import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  createInMemoryTransportPair,
  JsonRpcMessageLayer,
  McpClient,
  type McpClientOptions
} from "./internal.js";

async function fixture(options: Partial<McpClientOptions> = {}) {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  const client = new McpClient({
    clientInfo: { name: "test", version: "1" },
    onRootsList: () => [{ uri: "file:///workspace" }],
    ...options
  });
  onTestFinished(() => {
    server.dispose();
    clientTransport.dispose();
  });
  server.onRequest("server/discover", () => ({
    resultType: "complete",
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: {} },
    ttlMs: 0,
    cacheScope: "private"
  }));
  await client.connect(clientTransport);
  return { client, server };
}

describe("modern client results", () => {
  it("rejects server requests without invoking legacy callbacks", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    const client = new JsonRpcMessageLayer(clientTransport.readable, clientTransport.writable);
    const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
    onTestFinished(() => { client.dispose(); server.dispose(); clientTransport.dispose(); });
    client.requestMetadata = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { roots: {} }
    };
    const onRootsList = vi.fn(() => []);
    client.onRequest("roots/list", onRootsList);
    await expect(server.sendRequest("roots/list", {})).rejects.toMatchObject({ code: -32600 });
    expect(onRootsList).not.toHaveBeenCalled();
  });

  it.each([null, 1.5, "text", [1, null], true].map((value) => [value]))(
    "accepts structured JSON value %j",
    async (value) => {
      const { client, server } = await fixture();
      server.onRequest("tools/call", () => ({
        resultType: "complete",
        content: [],
        structuredContent: value
      }));
      expect((await client.callTool({ name: "typed" })).structuredContent).toEqual(value);
    }
  );
  it("rejects a legacy result envelope from a modern server", async () => {
    const { client, server } = await fixture();
    server.onRequest("tools/list", () => ({ tools: [] }));
    await expect(client.listTools()).rejects.toThrow("resultType");
  });
  it("fulfills root input requests and echoes opaque state on a fresh request ID", async () => {
    const { client, server } = await fixture();
    const attempts: Array<{ id: number | string; params: unknown }> = [];
    server.onRequest("tools/call", (params, context) => {
      attempts.push({ id: context.id, params });
      if (attempts.length === 1)
        return {
          resultType: "input_required",
          requestState: "opaque+/= .",
          inputRequests: { workspace: { method: "roots/list" } }
        };
      expect(params).toMatchObject({
        name: "roots",
        requestState: "opaque+/= .",
        inputResponses: { workspace: { roots: [{ uri: "file:///workspace" }] } }
      });
      return { resultType: "complete", content: [] };
    });
    expect(await client.callTool({ name: "roots" })).toMatchObject({ content: [] });
    expect(attempts).toHaveLength(2);
    expect(attempts[0].id).not.toBe(attempts[1].id);
  });
  it("rejects invalid sampling tool history before invoking the callback", async () => {
    const sampling = vi.fn(() => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "response" },
      model: "test"
    }));
    const { client, server } = await fixture({
      onSamplingRequest: sampling,
      capabilities: { sampling: { tools: {} } }
    });
    server.onRequest("tools/call", () => ({
      resultType: "input_required",
      inputRequests: {
        sample: {
          method: "sampling/createMessage",
          params: {
            maxTokens: 10,
            messages: [
              {
                role: "assistant",
                content: { type: "tool_use", id: "a", name: "lookup", input: {} }
              }
            ]
          }
        }
      }
    }));
    await expect(client.callTool({ name: "sample" })).rejects.toThrow("input_required");
    expect(sampling).not.toHaveBeenCalled();
  });
  it("rejects undeclared sampling tools before invoking the callback", async () => {
    const sampling = vi.fn(() => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "response" },
      model: "test"
    }));
    const { client, server } = await fixture({ onSamplingRequest: sampling });
    server.onRequest("tools/call", () => ({
      resultType: "input_required",
      inputRequests: {
        sample: {
          method: "sampling/createMessage",
          params: {
            maxTokens: 10,
            tools: [],
            messages: [{ role: "user", content: { type: "text", text: "sample" } }]
          }
        }
      }
    }));
    await expect(client.callTool({ name: "sample" })).rejects.toMatchObject({ code: -32021 });
    expect(sampling).not.toHaveBeenCalled();
  });

  it("fulfills form elicitation only through the supplied callback", async () => {
    const elicitation = vi.fn(() => ({ action: "decline" as const }));
    const { client, server } = await fixture({ onElicitationRequest: elicitation });
    let attempt = 0;
    server.onRequest("tools/call", (params) => {
      if (attempt++ === 0)
        return {
          resultType: "input_required",
          inputRequests: {
            name: {
              method: "elicitation/create",
              params: {
                message: "Name?",
                requestedSchema: { type: "object", properties: { name: { type: "string" } } }
              }
            }
          }
        };
      expect(params).toMatchObject({ inputResponses: { name: { action: "decline" } } });
      return { resultType: "complete", content: [] };
    });
    expect(await client.callTool({ name: "form" })).toMatchObject({ content: [] });
    expect(elicitation).toHaveBeenCalledTimes(1);
  });

  it("does not invoke later input callbacks after client close", async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: (value: Array<{ uri: string }>) => void;
    const held = new Promise<Array<{ uri: string }>>((resolve) => {
      finish = resolve;
    });
    const roots = vi.fn(() => {
      started();
      return held;
    });
    const { client, server } = await fixture({ onRootsList: roots });
    server.onRequest("tools/call", () => ({
      resultType: "input_required",
      inputRequests: {
        first: { method: "roots/list" },
        second: { method: "roots/list" }
      }
    }));
    const pending = client.callTool({ name: "roots" }).catch((error) => error);
    await entered;
    await client.close();
    finish([]);
    expect(await pending).toBeInstanceOf(Error);
    expect(roots).toHaveBeenCalledTimes(1);
  });
  it("retries the original parameters even if the caller mutates its input", async () => {
    const params = { name: "original", arguments: { value: 1 } };
    const { client, server } = await fixture({ onRootsList: () => {
      params.name = "changed"; params.arguments.value = 2;
      return [];
    } });
    let attempt = 0;
    server.onRequest("tools/call", (request) => {
      if (attempt++ === 0) return { resultType: "input_required", inputRequests: { roots: { method: "roots/list" } } };
      expect(request).toMatchObject({ name: "original", arguments: { value: 1 } });
      return { resultType: "complete", content: [] };
    });
    expect(await client.callTool(params)).toMatchObject({ content: [] });
  });

});
