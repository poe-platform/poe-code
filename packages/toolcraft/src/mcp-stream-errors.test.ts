import { describe, expect, it, onTestFinished, vi } from "vitest";
import { S } from "toolcraft-schema";
import { ToolError } from "tiny-stdio-mcp-server";
import { defineCommand, defineGroup, defineStreamCommand, UserError } from "./index.js";
import { createMCPServer } from "./mcp.js";

async function createFixture(requirementFailure?: Error) {
  const handler = vi.fn();
  const config = {
    scope: ["mcp"] as const,
    params: S.Object({ target: S.String() }),
    ...(requirementFailure === undefined ? {} : {
      requires: { check() { throw requirementFailure; } }
    })
  };
  const root = defineGroup({
    name: "audit",
    children: [
      defineCommand({ ...config, name: "check", handler: () => { handler(); return "ok"; } }),
      defineStreamCommand({
        ...config,
        name: "watch",
        event: S.String(),
        async *handler() { handler(); yield "ok"; }
      })
    ]
  });
  let resolveEvent: (event: unknown) => void;
  const event = new Promise<unknown>((resolve) => { resolveEvent = resolve; });
  const session = createMCPServer(root, { name: "audit", version: "1", errorReports: false })
    .createMessageSession((notification) => {
      if (notification.params?.type === "data") resolveEvent(notification.params.event);
    });
  onTestFinished(() => session.close());
  await session.handleMessage("initialize", {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
  });
  await session.handleMessage("notifications/initialized");
  return { session, handler, event };
}

describe("MCP stream subscription errors", () => {
  it.each([
    { name: "missing", arguments: {} },
    { name: "wrong type", arguments: { target: 42 } },
    { name: "unexpected field", arguments: { target: "sample", extra: true } }
  ])("matches normal invalid-params errors for $name input", async ({ arguments: input }) => {
    const { session, handler } = await createFixture();
    const normal = await session.handleMessage("tools/call", { name: "audit__check", arguments: input });
    const stream = await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: input });

    expect(normal).toMatchObject({ error: { code: -32602 } });
    expect(stream).toEqual(normal);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["audit__missing", undefined])("classifies unavailable stream %s as invalid params", async (name) => {
    const { session, handler } = await createFixture();
    const result = await session.handleMessage("toolcraft/streams/subscribe", {
      name, arguments: { target: "sample" }
    });

    expect(result).toMatchObject({ error: { code: -32602, message: expect.stringContaining("Stream not found:") } });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { failure: new UserError("Requirement unavailable."), code: -32602 },
    { failure: new Error("Requirement crashed."), code: -32603 },
    { failure: new ToolError(-32042, "Requirement protocol error.", { retryable: false }), code: -32042 }
  ])("preserves normal requirement-error mapping for $code", async ({ failure, code }) => {
    const { session, handler } = await createFixture(failure);
    const normal = await session.handleMessage("tools/call", { name: "audit__check", arguments: { target: "sample" } });
    const stream = await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: { target: "sample" } });

    expect(normal).toMatchObject({ error: { code, message: failure.message } });
    expect(stream).toEqual(normal);
    expect(handler).not.toHaveBeenCalled();
  });

  it("retains successful subscription and data delivery", async () => {
    const { session, handler, event } = await createFixture();
    const result = await session.handleMessage("toolcraft/streams/subscribe", {
      name: "audit__watch", arguments: { target: "sample" }
    });

    expect(result).toMatchObject({ result: { subscriptionId: expect.any(String) } });
    await expect(event).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledOnce();
  });
});
