import { expect, it, onTestFinished, vi } from "vitest";
import { createInMemoryTransportPair, JsonRpcMessageLayer, McpClient, type McpClientOptions } from "./internal.js";

async function fixture(options: Partial<McpClientOptions>) {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26", ...options });
  onTestFinished(async () => { await client.close(); server.dispose(); clientTransport.dispose(); });
  server.onRequest("initialize", () => ({ protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "legacy", version: "1" } }));
  await client.connect(clientTransport);
  return { client, server };
}

it("rejects malformed sampling requests before invoking client callbacks", async () => {
  const callback = vi.fn(() => ({ role: "assistant" as const, model: "test", content: { type: "text" as const, text: "ready" } }));
  const { server } = await fixture({ onSamplingRequest: callback });
  await expect(server.sendRequest("sampling/createMessage", { messages: "invalid", maxTokens: 10 }))
    .rejects.toMatchObject({ code: -32602 });
  expect(callback).not.toHaveBeenCalled();
});

it("rejects malformed sampling responses instead of sending them to servers", async () => {
  const { server } = await fixture({ onSamplingRequest: () => ({ role: "assistant", model: "test", content: { type: "text", text: 123 } }) as never });
  await expect(server.sendRequest("sampling/createMessage", { messages: [], maxTokens: 10 }))
    .rejects.toMatchObject({ code: -32603 });
});

it("rejects non-file root URIs in legacy callbacks", async () => {
  const { server } = await fixture({ onRootsList: () => [{ uri: "https://workspace.example" }] });
  await expect(server.sendRequest("roots/list")).rejects.toMatchObject({ code: -32603 });
});

it("serves configured elicitation callbacks over a legacy connection", async () => {
  const callback = vi.fn(() => ({ action: "decline" as const }));
  const { server } = await fixture({ onElicitationRequest: callback });
  await expect(server.sendRequest("elicitation/create", {
    message: "Name?", requestedSchema: { type: "object", properties: { name: { type: "string" } } }
  })).resolves.toEqual({ action: "decline" });
  expect(callback).toHaveBeenCalledOnce();
  expect(callback.mock.calls[0]).toHaveLength(2);
});
