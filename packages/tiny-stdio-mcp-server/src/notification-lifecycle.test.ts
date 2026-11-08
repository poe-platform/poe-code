import { expect, it, onTestFinished, vi } from "vitest";
import { createServer, type MessageSessionContext } from "./server.js";

async function openContext(listener: Parameters<ReturnType<typeof createServer>["createMessageSession"]>[0]) {
  let context: MessageSessionContext | undefined;
  const server = createServer({ name: "test", version: "1" }).method("capture", (_params, session) => { context = session; return {}; });
  const session = server.createMessageSession(listener);
  onTestFinished(() => session.close());
  await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  await session.handleMessage("notifications/initialized");
  await session.handleMessage("capture");
  if (context === undefined) throw new Error("Expected session context");
  return { session, context };
}

it("suppresses new notifications on a closed context without affecting healthy contexts", async () => {
  const closedListener = vi.fn();
  const healthyListener = vi.fn();
  const closed = await openContext(closedListener);
  const healthy = await openContext(healthyListener);
  await closed.context.notify("notifications/test", { value: "before" });
  closed.session.close();
  expect(closed.context.signal.aborted).toBe(true);
  await closed.context.notify("notifications/test", { value: "after" });
  await healthy.context.notify("notifications/test", { value: "healthy" });
  expect(closedListener).toHaveBeenCalledExactlyOnceWith({ jsonrpc: "2.0", method: "notifications/test", params: { value: "before" } });
  expect(healthyListener).toHaveBeenCalledOnce();
});

it("does not suppress a caller-owned rejection from delivery already started before close", async () => {
  let rejectDelivery: (reason: unknown) => void;
  const pending = new Promise<void>((_, reject) => { rejectDelivery = reject; });
  const listener = vi.fn(() => pending);
  const { session, context } = await openContext(listener);
  const delivery = context.notify("notifications/test");
  const failure = new Error("in-flight failure");
  session.close();
  rejectDelivery!(failure);
  await expect(delivery).rejects.toBe(failure);
  expect(listener).toHaveBeenCalledOnce();
});

it.each([false, true])("retains active-session delivery errors with asynchronous=%s", async (asynchronous) => {
  const failure = new Error("listener failed");
  const { context } = await openContext(() => {
    if (asynchronous) return Promise.reject(failure);
    throw failure;
  });
  await expect(context.notify("notifications/test")).rejects.toBe(failure);
});
