import { expect, test, vi } from "vitest";

vi.mock("../src/browser-page-cdp", () => ({
  browserPageCDP: async () => ({
    send: async () => ({ targetInfo: { targetId: "page", browserContextId: "context" } })
  })
}));
vi.mock("../src/browser-run-code-native", () => ({
  runCodeContextOptions: () => ({}),
  captureRunCodeContextState: () => ({}),
  captureRunCodePageState: () => ({}),
  captureRunCodeTimeouts: () => ({})
}));
vi.mock("../src/browser-run-code-relay", () => ({ createRunCodeRelay: vi.fn() }));
import { createRunCodeRelay } from "../src/browser-run-code-relay";
import { createBrowserRunCode } from "../src/browser-run-code";

test.each([true, false])("cleanup failure retains guest error and retires (guest rejected: %s)", async (rejected) => {
  const receiverError = new Error("receiver close lost connection");
  const cleanupError = new AggregateError([receiverError], "Run-code transport cleanup failed");
  const closing = Promise.reject(cleanupError);
  void closing.catch(() => {});
  const operations: string[] = [];
  let closingTask: Promise<void> | undefined;
  vi.mocked(createRunCodeRelay).mockReturnValue({
    capability: {}, close: () => {
      if (!closingTask) {
        operations.push("close");
        closingTask = closing.finally(() => { operations.push("closed"); });
        void closingTask.catch(() => {});
      }
      return closingTask;
    }, opened: () => true
  } as never);
  const detach = vi.fn(async () => {});
  const send = vi.fn(async (method: string) => {
    if (method === "Target.getTargets") return { targetInfos: [] };
    if (method === "Target.getBrowserContexts") return { browserContextIds: ["context"] };
    return {};
  });
  const context = { pages: () => [page] };
  const page = { context: () => context };
  const retire = vi.fn(async () => {});
  const run = createBrowserRunCode({
    ownerId: "cleanup-test",
    browser: { newBrowserCDPSession: async () => ({ send, detach, on() {} }) },
    loader: { load: () => ({ getEntrypoint: () => ({ [Symbol.dispose]: () => operations.push("dispose"), run: async () => ({
      ok: !rejected,
      message: "Run-code result is not JSON-serializable",
      json: "1",
      stateJson: JSON.stringify({
        context: { headers: [], offline: false, geolocation: null },
        pages: [], contextInitScripts: [], contextTimeouts: { action: null, navigation: null }
      })
    }) }) }) },
    guestSource: "", connectSocket: vi.fn(), retire
  } as never);
  const error = await run({
    page, source: "async page => 1n", signal: new AbortController().signal,
    timeoutMs: 1000, maxOutputBytes: 1024, maxPages: 4
  } as never).catch((error: unknown) => error);
  if (rejected) {
    expect(String(error)).toContain("Run-code result is not JSON-serializable");
    expect(error).toBeInstanceOf(AggregateError);
    const combined = error as AggregateError;
    expect(combined.errors[0].message).toBe("Run-code result is not JSON-serializable");
    expect(combined.cause).toBe(combined.errors[0]);
    expect(combined.errors[1]).toBe(cleanupError);
  } else {
    expect(error).toBe(cleanupError);
  }
  expect(retire).toHaveBeenCalledOnce();
  expect(detach).toHaveBeenCalledOnce();
  expect(operations.slice(0, 3)).toEqual(["close", "closed", "dispose"]);
  expect(operations.filter((operation) => operation === "dispose")).toHaveLength(1);
  // No state restoration is safe after unconfirmed transport cleanup.
  expect(send.mock.calls.filter(([method]) => method === "Target.getBrowserContexts")).toHaveLength(1);
});
