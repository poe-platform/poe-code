import { afterEach, expect, test, vi } from "vitest";
import { createBrowserPrivateTransport } from "../src/browser-private-transport.js";
import { admitPlaywrightProtocolFrame, createPlaywrightPrivateTargetTransport } from "../../safe-bash/src/playwright/private-target-transport.js";

vi.mock("@poe-platform/safe-bash/playwright", async () => await import("../../safe-bash/src/playwright/private-target-transport.js"));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const names = ["maxGraphNodes", "maxGraphDepth", "maxQueuedCommands", "maxBufferedMessages", "maxPrivateTargets", "maxPrivateSessions", "creationTimeoutMs", "commandTimeoutMs", "maxMessageBytes", "maxPendingBytes", "maxBufferedBytes", "maxPendingCommands"];
test.each(names)("private transports accept unlimited %s", async name => {
  const options = { [name]: Infinity };
  const guard = createPlaywrightPrivateTargetTransport({ send() {}, close() {} }, options);
  guard.beginCreation().rollback();
  guard.transport.close();
  const browser = createBrowserPrivateTransport(options);
  browser.beginCreation().rollback();
  await browser.close();
});
test("browser client capacity can be unlimited", async () => {
  await createBrowserPrivateTransport({ maxClients: Infinity }).close();
});
test("default and explicit unlimited graph depth admit deep protocol frames", () => {
  const data = '{"value":' + '['.repeat(70) + '0' + ']'.repeat(70) + '}';
  expect(() => admitPlaywrightProtocolFrame(data)).not.toThrow();
  expect(() => admitPlaywrightProtocolFrame(data, { maxGraphDepth: Infinity })).not.toThrow();
  expect(() => admitPlaywrightProtocolFrame(data, { maxGraphDepth: 64 })).toThrow();
});
test.each([{}, Object.fromEntries(names.map(name => [name, Infinity]))])("unlimited transports schedule no command or creation timers: %j", async options => {
  vi.useFakeTimers();
  const guard = createPlaywrightPrivateTargetTransport({ send() {}, close() {} }, options);
  guard.transport.open?.();
  guard.transport.send({ id: 1, method: "Browser.getVersion" });
  guard.beginCreation().rollback();
  const browser = createBrowserPrivateTransport(options);
  const timeout = vi.spyOn(AbortSignal, "timeout");
  browser.beginCreation().rollback();
  expect(timeout).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  guard.transport.close();
  await browser.close();
});

test.each([0, -1, NaN, -Infinity, 1.5, null])("transports reject invalid explicit budgets: %s", value => {
  for (const name of names) {
    const options = { [name]: value } as unknown as Record<string, number>;
    expect(() => createPlaywrightPrivateTargetTransport({ send() {}, close() {} }, options)).toThrow("Invalid private transport limit");
    expect(() => createBrowserPrivateTransport(options)).toThrow("Invalid private browser limit");
  }
});
test("default target capacity exceeds the former 256-target budget", async () => {
  const guard = createPlaywrightPrivateTargetTransport({ send() {}, close() {} });
  const browser = createBrowserPrivateTransport();
  for (let id = 0; id < 257; id++) {
    guard.beginCreation().commit(`target-${id}`);
    browser.beginCreation().commit(`target-${id}`);
  }
  guard.transport.close();
  await browser.close();
});
