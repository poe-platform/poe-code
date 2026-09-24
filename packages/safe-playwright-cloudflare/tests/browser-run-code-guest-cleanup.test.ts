import { expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ close: vi.fn(), userCode: vi.fn(), serializeState: vi.fn(() => "{}") }));
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
    connect: async () => ({
      contexts: () => [context],
      close: fixture.close,
      newBrowserCDPSession: async () => ({
        send: async () => ({ targetInfos: [{ targetId: "page", browserContextId: "context" }] }),
        detach: async () => {}
      })
    })
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
