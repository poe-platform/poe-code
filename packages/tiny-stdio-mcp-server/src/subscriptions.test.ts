import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "./index.js";
import type { JSONRPCNotification } from "./index.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

describe("modern notification subscriptions", () => {
  it("bounds active requests and releases subscription capacity on cancellation", async () => {
    const server = createServer({ name: "subscriptions", version: "1", maxActiveRequests: 1 });
    const session = server.createMessageSession(vi.fn());
    onTestFinished(() => session.close());
    const listening = session.handleMessage(
      "subscriptions/listen",
      { _meta: metadata, notifications: {} },
      { requestId: 1 }
    );
    await Promise.resolve();
    expect(
      await session.handleMessage(
        "subscriptions/listen",
        { _meta: metadata, notifications: {} },
        { requestId: 2 }
      )
    ).toMatchObject({ error: { code: -32000 } });
    await session.handleMessage("notifications/cancelled", { requestId: 1 });
    await listening;
    expect(
      await session.handleMessage("tools/list", { _meta: metadata }, { requestId: 3 })
    ).toHaveProperty("result");
  });
  it("acknowledges first, tags the request ID, and delivers only opted-in notifications", async () => {
    const server = createServer({ name: "subscriptions", version: "1" });
    let acknowledge!: () => void;
    const acknowledged = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const listener = vi.fn((_notification: JSONRPCNotification) => {
      acknowledge();
    });
    const session = server.createMessageSession(listener);
    onTestFinished(() => session.close());
    const listening = session.handleMessage(
      "subscriptions/listen",
      {
        _meta: metadata,
        notifications: { toolsListChanged: true }
      },
      { requestId: "tools" }
    );
    await acknowledged;
    await server.notifyToolsChanged();
    await server.notifyPromptsChanged();
    await server.notifyResourcesChanged();

    expect(listener.mock.calls.map(([notification]) => notification)).toEqual([
      {
        jsonrpc: "2.0",
        method: "notifications/subscriptions/acknowledged",
        params: {
          _meta: { "io.modelcontextprotocol/subscriptionId": "tools" },
          notifications: { toolsListChanged: true }
        }
      },
      {
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        params: {
          _meta: { "io.modelcontextprotocol/subscriptionId": "tools" }
        }
      }
    ]);
    await session.handleMessage("notifications/cancelled", { requestId: "tools" });
    await listening;
    await server.notifyToolsChanged();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("isolates multiple subscriptions and cancellation on one connection", async () => {
    const server = createServer({ name: "subscriptions", version: "1" });
    const listener = vi.fn();
    const session = server.createMessageSession(listener);
    onTestFinished(() => session.close());
    const tools = session.handleMessage(
      "subscriptions/listen",
      { _meta: metadata, notifications: { toolsListChanged: true } },
      { requestId: 1 }
    );
    const prompts = session.handleMessage(
      "subscriptions/listen",
      { _meta: metadata, notifications: { promptsListChanged: true } },
      { requestId: "1" }
    );
    await Promise.resolve();
    await session.handleMessage("notifications/cancelled", { requestId: 1 });
    await tools;
    listener.mockClear();
    await server.notifyToolsChanged();
    await server.notifyPromptsChanged();
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      jsonrpc: "2.0",
      method: "notifications/prompts/list_changed",
      params: {
        _meta: { "io.modelcontextprotocol/subscriptionId": "1" }
      }
    });
    session.close();
    await prompts;
  });

  it("filters resource updates and snapshots the requested URI list", async () => {
    const server = createServer({ name: "subscriptions", version: "1" });
    const listener = vi.fn();
    const session = server.createMessageSession(listener);
    onTestFinished(() => session.close());
    const uris = ["memo://selected"];
    const listening = session.handleMessage(
      "subscriptions/listen",
      { _meta: metadata, notifications: { resourceSubscriptions: uris } },
      { requestId: 2 }
    );
    await Promise.resolve();
    uris.push("memo://other");
    listener.mockClear();
    await server.notifyResourceUpdated("memo://other");
    await server.notifyResourceUpdated("memo://selected");
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: {
        uri: "memo://selected",
        _meta: { "io.modelcontextprotocol/subscriptionId": 2 }
      }
    });
    session.close();
    await listening;
  });

  it("acknowledges an empty supported subset when notification support is disabled", async () => {
    const server = createServer({
      name: "subscriptions",
      version: "1",
      supportNotifications: false,
      supportResourceSubscriptions: false
    });
    const listener = vi.fn();
    const session = server.createMessageSession(listener);
    onTestFinished(() => session.close());
    const listening = session.handleMessage(
      "subscriptions/listen",
      {
        _meta: metadata,
        notifications: {
          toolsListChanged: true,
          resourceSubscriptions: ["memo://selected"]
        }
      },
      { requestId: 3 }
    );
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "notifications/subscriptions/acknowledged",
      params: {
        _meta: { "io.modelcontextprotocol/subscriptionId": 3 },
        notifications: {}
      }
    });
    session.close();
    await listening;
  });

  it.each(
    [null, [], { toolsListChanged: "yes" }, { resourceSubscriptions: [123] }].map(
      (notifications) => ({ notifications })
    )
  )("rejects malformed filters %j", async ({ notifications }) => {
    const server = createServer({ name: "subscriptions", version: "1" });
    const session = server.createMessageSession(vi.fn());
    onTestFinished(() => session.close());
    expect(
      await session.handleMessage(
        "subscriptions/listen",
        { _meta: metadata, notifications },
        { requestId: 4 }
      )
    ).toMatchObject({ error: { code: -32602 } });
  });

  it("requires the originating request ID", async () => {
    const server = createServer({ name: "subscriptions", version: "1" });
    expect(
      await server.handleMessage("subscriptions/listen", { _meta: metadata, notifications: {} })
    ).toMatchObject({ error: { code: -32602 } });
  });
});
