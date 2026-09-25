import { expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), userCode: vi.fn(), serializeState: vi.fn(() => "{}") }));
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, WorkerEntrypoint: class {} }));
vi.mock("browser-user-code.js", () => ({ default: fixture.userCode }));
vi.mock("../src/browser-run-code-context-state.js", () => ({
  restoreRunCodeContextState: async () => {}
}));
vi.mock("../src/browser-run-code-native.js", () => ({
  adoptRunCodeContext() {},
  captureRunCodeState: () => ({}),
  restoreRunCodePageState: async () => {},
  runCodePageTarget: () => "page"
}));
vi.mock("../src/browser-run-code-state.js", () => ({ serializeRunCodeState: fixture.serializeState }));
vi.mock("../src/browser-screenshot.js", () => ({ prepareBrowserScreenshots() {} }));
vi.mock("@cloudflare/playwright", () => {
  const context = { pages: () => [page], on() {} };
  const page = { context: () => context };
  return {
    connect: async (binding: unknown) => {
      await fixture.connect(binding);
      return {
      contexts: () => [context],
      isConnected: () => true,
      close: fixture.close,
      newBrowserCDPSession: async () => ({
        send: async () => ({ targetInfos: [{ targetId: "page", browserContextId: "context" }] }),
        detach: async () => {}
      })
      };
    }
  };
});
import Guest from "../src/browser-run-code-guest.js";

const metadata = {
  contextId: "context",
  targetId: "page",
  maxOutputBytes: 1024,
  state: { context: {}, pages: [{ targetId: "page" }] }
};

test("guest retains serialization failure when browser close rejects", async () => {
  fixture.userCode.mockResolvedValueOnce(1n);
  const cleanup = new Error("Network connection lost");
  fixture.close.mockRejectedValueOnce(cleanup);
  const error = await new Guest().run({} as never, metadata as never).catch((error) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.message).toContain("Run-code result is not JSON-serializable");
  expect(error.cause.message).toContain("Run-code result is not JSON-serializable");
  expect(error.errors[1]).toBe(cleanup);
});

test("guest returns serialization error and state after successful cleanup", async () => {
  fixture.userCode.mockResolvedValueOnce(1n);
  fixture.close.mockResolvedValueOnce(undefined);
  await expect(new Guest().run({} as never, metadata as never)).resolves.toEqual({
    ok: false,
    message: "Error: Run-code result is not JSON-serializable",
    stateJson: "{}"
  });
});

test("guest rejects successful execution when cleanup fails", async () => {
  fixture.userCode.mockResolvedValueOnce(1);
  const cleanup = new Error("Network connection lost");
  fixture.close.mockRejectedValueOnce(cleanup);
  await expect(new Guest().run({} as never, metadata as never)).rejects.toBe(cleanup);
});

test("guest retains output limit failure when cleanup also fails", async () => {
  fixture.userCode.mockResolvedValueOnce("too large");
  const cleanup = new Error("Network connection lost");
  fixture.close.mockRejectedValueOnce(cleanup);
  const error = await new Guest()
    .run({} as never, { ...metadata, maxOutputBytes: 1 } as never)
    .catch((error) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause.message).toBe("Run-code output limit exceeded");
  expect(error.errors[1]).toBe(cleanup);
});

test("guest returns output refusal with recoverable state after confirmed cleanup", async () => {
  fixture.userCode.mockResolvedValueOnce("界");
  fixture.close.mockResolvedValueOnce(undefined);
  await expect(new Guest().run({} as never, { ...metadata, maxOutputBytes: 4 } as never)).resolves.toMatchObject({
    ok: false, message: "Error: Run-code output limit exceeded", stateJson: "{}"
  });
});

test("guest output byte boundaries use JSON UTF-8 bytes and allow omission", async () => {
  for (const maxOutputBytes of [undefined, 5]) {
    fixture.userCode.mockResolvedValueOnce("界");
    fixture.close.mockResolvedValueOnce(undefined);
    await expect(new Guest().run({} as never, { ...metadata, maxOutputBytes } as never)).resolves.toMatchObject({
      ok: true, json: '"界"', stateJson: "{}"
    });
  }
});

test.each([false, true])("guest retains serialization error when state capture fails (close fails: %s)", async (closeFails) => {
  fixture.userCode.mockResolvedValueOnce(1n);
  const stateError = new Error("Run-code state limit exceeded");
  fixture.serializeState.mockImplementationOnce(() => { throw stateError; });
  const cleanup = new Error("Network connection lost");
  if (closeFails) fixture.close.mockRejectedValueOnce(cleanup);
  else fixture.close.mockResolvedValueOnce(undefined);
  const error = await new Guest().run({} as never, metadata as never).catch((error) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause.message).toContain("Run-code result is not JSON-serializable");
  expect(error.errors).toEqual(closeFails ? [error.cause, stateError, cleanup] : [error.cause, stateError]);
});

test.each([
  { rejected: false, cleanupFails: false },
  { rejected: true, cleanupFails: false },
  { rejected: false, cleanupFails: true },
  { rejected: true, cleanupFails: true }
])("guest joins transport shutdown (user rejected: $rejected, cleanup fails: $cleanupFails)", async ({ rejected, cleanupFails }) => {
  const closing = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let receiver: { frame(message: string): void };
  let socketClosed = false;
  const socket = Object.assign(new EventTarget(), {
    accept() {},
    close() { socketClosed = true; },
    send: vi.fn(() => {
      if (socketClosed) throw new TypeError("Can't call WebSocket send() after close().");
    })
  });
  vi.stubGlobal("WebSocketPair", class { 0 = socket; 1 = socket; });
  vi.stubGlobal("Response", class {});
  const session = { send: vi.fn(), close: vi.fn(() => { started.resolve(); return closing.promise; }) };
  fixture.connect.mockImplementationOnce(async (binding) => {
    await binding.fetch("http://fake.host/v1/devtools/browser/owned?persistent=true");
    receiver.frame("active reply");
    socket.dispatchEvent(new MessageEvent("message", { data: "active command" }));
    await Promise.resolve();
  });
  const browserClose = vi.fn(async () => {
    socket.close();
    socket.dispatchEvent(new Event("close"));
    receiver.frame("trailing reply");
    socket.dispatchEvent(new MessageEvent("message", { data: "trailing command" }));
  });
  fixture.close.mockImplementationOnce(browserClose);
  fixture.userCode.mockResolvedValueOnce(rejected ? 1n : 1);
  const cleanupError = new Error("Run-code transport cleanup failed");
  let settled = false;
  const result = new Guest().run({ open: async (_url: string, callback: typeof receiver) => {
    receiver = callback;
    return session;
  } } as never, metadata as never);
  const outcome = result.then(value => { settled = true; return value; }, error => { settled = true; return error; });
  try {
    await started.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(browserClose).toHaveBeenCalledOnce();
  } finally {
    if (cleanupFails) closing.reject(cleanupError);
    else closing.resolve();
    await outcome;
    vi.unstubAllGlobals();
  }
  expect(session.close).toHaveBeenCalledOnce();
  expect(browserClose).toHaveBeenCalledOnce();
  expect(socket.send).toHaveBeenCalledExactlyOnceWith("active reply");
  expect(session.send).toHaveBeenCalledExactlyOnceWith("active command");
  if (cleanupFails) {
    const error = await outcome;
    if (rejected) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.cause.message).toBe("Run-code result is not JSON-serializable");
      expect(error.errors).toEqual([error.cause, cleanupError]);
    } else expect(error).toBe(cleanupError);
  } else {
    await expect(result).resolves.toMatchObject(rejected
      ? { ok: false, message: "Error: Run-code result is not JSON-serializable" }
      : { ok: true, json: "1" });
  }
});
