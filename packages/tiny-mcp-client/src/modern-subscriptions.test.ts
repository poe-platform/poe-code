import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  createInMemoryTransportPair,
  JsonRpcMessageLayer,
  McpClient,
  type McpClientOptions
} from "./internal.js";

async function fixture(options: Partial<McpClientOptions> = {}, acknowledge = true) {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  const requests: Array<{ id: string | number; params: unknown }> = [];
  const complete = new Map<string | number, (result: unknown) => void>();
  const send = (method: string, id: string | number, params: Record<string, unknown> = {}) => {
    serverTransport.writable.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: {
          ...params,
          _meta: { "io.modelcontextprotocol/subscriptionId": id }
        }
      }) + "\n"
    );
  };
  server.onRequest("server/discover", () => ({
    resultType: "complete",
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: {}, resources: {}, prompts: {} },
    ttlMs: 0,
    cacheScope: "private"
  }));
  server.onRequest("subscriptions/listen", (params, context) => {
    requests.push({ id: context.id, params });
    if (acknowledge)
      send("notifications/subscriptions/acknowledged", context.id, {
        notifications: (params as { notifications: unknown }).notifications
      });
    return new Promise((resolve) => {
      complete.set(context.id, resolve);
    });
  });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, ...options });
  onTestFinished(async () => {
    for (const [id, resolve] of complete)
      resolve({ resultType: "complete", _meta: { "io.modelcontextprotocol/subscriptionId": id } });
    await client.close();
    server.dispose();
    clientTransport.dispose();
  });
  await client.connect(clientTransport);
  return { client, requests, send, complete };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("modern client subscriptions", () => {
  it("automatically listens for configured list-change callbacks and correlates notifications", async () => {
    const changed = vi.fn();
    const { requests, send } = await fixture({ onToolsChanged: changed });
    expect(requests).toHaveLength(1);
    expect(requests[0].params).toMatchObject({ notifications: { toolsListChanged: true } });
    send("notifications/tools/list_changed", requests[0].id);
    send("notifications/tools/list_changed", "unrelated");
    await settle();
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("supports graceful completion and releases a subscription", async () => {
    const { client, complete } = await fixture();
    const listening = await client.listenNotifications({ promptsListChanged: true });
    expect(listening.notifications).toEqual({ promptsListChanged: true });
    complete.get(listening.id)!({
      resultType: "complete",
      _meta: { "io.modelcontextprotocol/subscriptionId": listening.id }
    });
    await expect(listening.closed).resolves.toBeUndefined();
  });
  it("maps resource subscribe/unsubscribe to modern long-lived requests", async () => {
    const updated = vi.fn();
    const { client, requests, send } = await fixture({ onResourceUpdated: updated });
    await client.subscribe("file:///selected");
    expect(requests).toHaveLength(1);
    send("notifications/resources/updated", requests[0].id, { uri: "file:///selected" });
    send("notifications/resources/updated", requests[0].id, { uri: "file:///other" });
    await settle();
    expect(updated).toHaveBeenCalledExactlyOnceWith("file:///selected");
    await client.unsubscribe("file:///selected");
    send("notifications/resources/updated", requests[0].id, { uri: "file:///selected" });
    await settle();
    expect(updated).toHaveBeenCalledTimes(1);
  });
  it("reopens a resource subscription after graceful completion", async () => {
    const { client, requests, complete } = await fixture();
    await client.subscribe("file:///selected");
    const id = requests[0].id;
    complete.get(id)!({
      resultType: "complete",
      _meta: { "io.modelcontextprotocol/subscriptionId": id }
    });
    await settle();
    await client.subscribe("file:///selected");
    expect(requests).toHaveLength(2);
  });
  it("coalesces concurrent subscriptions to the same resource", async () => {
    const { client, requests } = await fixture();
    await Promise.all([client.subscribe("file:///selected"), client.subscribe("file:///selected")]);
    expect(requests).toHaveLength(1);
  });

  it("stops delivering subscription notifications when the caller aborts", async () => {
    const changed = vi.fn();
    const { client, send } = await fixture({ onToolsChanged: changed });
    const controller = new AbortController();
    const listening = await client.listenNotifications(
      { toolsListChanged: true },
      { signal: controller.signal }
    );
    controller.abort(new Error("stop"));
    send("notifications/tools/list_changed", listening.id);
    await settle();
    expect(changed).not.toHaveBeenCalled();
  });
  it("does not send a pre-aborted subscription", async () => {
    const { client, requests } = await fixture();
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(
      client.listenNotifications({ toolsListChanged: true }, { signal: controller.signal })
    ).rejects.toBe(reason);
    expect(requests).toHaveLength(0);
  });

  it("cancels a resource subscription before its acknowledgement arrives", async () => {
    const { client, requests, send } = await fixture({}, false);
    const subscribing = client.subscribe("file:///selected").catch((error) => error);
    await settle();
    expect(requests).toHaveLength(1);
    await client.unsubscribe("file:///selected");
    expect(await subscribing).toBeInstanceOf(Error);
    const retry = client.subscribe("file:///selected");
    await settle();
    expect(requests).toHaveLength(2);
    send("notifications/subscriptions/acknowledged", requests[1].id, {
      notifications: { resourceSubscriptions: ["file:///selected"] }
    });
    await expect(retry).resolves.toBeUndefined();
  });
  it("delivers resources selected through the explicit notification-stream API", async () => {
    const updated = vi.fn();
    const { client, send } = await fixture({ onResourceUpdated: updated });
    const listening = await client.listenNotifications({ resourceSubscriptions: ["file:///selected"] });
    send("notifications/resources/updated", listening.id, { uri: "file:///selected" });
    send("notifications/resources/updated", listening.id, { uri: "file:///other" });
    await settle();
    expect(updated).toHaveBeenCalledExactlyOnceWith("file:///selected");
  });

});

it.each([" file:///data", "file:///bad%zz", "file:///a\nb"])("rejects lossy URI subscription filters before sending: %j", async (uri) => {
  const { client, requests } = await fixture();
  await expect(client.listenNotifications({ resourceSubscriptions: [uri] })).rejects.toThrow("absolute URIs");
  expect(requests).toHaveLength(0);
});
