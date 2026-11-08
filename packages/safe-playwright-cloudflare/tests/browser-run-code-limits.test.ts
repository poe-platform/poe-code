import { afterEach, expect, test, vi } from "vitest";
import type { BrowserRunCodeInput } from "../src/browser-run-code-contract";

vi.mock("../src/browser-page-cdp", () => ({
  browserPageCDP: async () => ({ send: async () => ({ targetInfo: { targetId: "page", browserContextId: "context" } }) })
}));
vi.mock("../src/browser-run-code-native", () => ({
  runCodeContextOptions: () => ({}), captureRunCodeContextState: () => ({}),
  captureRunCodePageState: () => ({ targetId: "page" }), captureRunCodeTimeouts: () => ({}),
  validateRunCodePageOwnership: vi.fn(), restoreRunCodePageState: vi.fn(async () => {}),
  restoreRunCodeTimeouts: vi.fn()
}));
vi.mock("../src/browser-run-code-context-state", async (original) => ({
  ...await original<object>(), restoreRunCodeContextState: vi.fn(async () => {})
}));
vi.mock("../src/browser-run-code-relay", () => ({ createRunCodeRelay: vi.fn() }));
import { createRunCodeRelay } from "../src/browser-run-code-relay";
import { restoreRunCodeContextState } from "../src/browser-run-code-context-state";
import { createBrowserRunCode } from "../src/browser-run-code";

afterEach(() => { vi.restoreAllMocks(); });

function fixture(count = 1) {
  const state = {
    context: { headers: [], offline: false, geolocation: null },
    pages: [{ targetId: "page", viewport: null, size: null, media: {},
      timeouts: { action: null, navigation: null }, initScripts: [] }],
    contextInitScripts: [], contextTimeouts: { action: null, navigation: null }
  };
  const context = { pages: () => [page] };
  const page = { context: () => context, isClosed: () => false };
  const close = vi.fn(async () => {});
  vi.mocked(createRunCodeRelay).mockReturnValue({ capability: {}, close, opened: () => true } as never);
  const retire = vi.fn(async () => {});
  const run = vi.fn(async () => ({ ok: true, json: "1", stateJson: JSON.stringify(state) }));
  const load = vi.fn((_options: object) => ({ getEntrypoint: () => ({ run }) }));
  const send = vi.fn(async (method: string) => {
    if (method === "Target.getTargets") return { targetInfos: Array.from({ length: count }, (_, id) => ({
      targetId: `page-${id}`, type: "page", browserContextId: "context"
    })) };
    if (method === "Target.getBrowserContexts") return { browserContextIds: ["context"] };
    return {};
  });
  const execute = createBrowserRunCode({
    ownerId: "limits-test", browser: { contexts: () => [context], newBrowserCDPSession: async () => ({ send, on() {}, detach: async () => {} }) },
    loader: { load }, guestSource: "", connectSocket: vi.fn(), retire
  } as never);
  const input: BrowserRunCodeInput = { page: page as never, source: "async page => 1", signal: new AbortController().signal };
  return { execute, input, run, load, retire, state, close };
}

test("omitted limits accept large source, result and browser census without loader resource ceilings", async () => {
  const f = fixture(65);
  const value = "x".repeat(17 * 1024 * 1024);
  f.input.source += `/*${"x".repeat(1024 * 1024)}*/`;
  f.run.mockResolvedValueOnce({ ok: true, json: JSON.stringify(value), stateJson: JSON.stringify(f.state) });
  await expect(f.execute(f.input)).resolves.toBe(value);
  expect(f.load.mock.calls[0]?.[0]).not.toHaveProperty("limits");
  expect(f.retire).not.toHaveBeenCalled();
});

test("individual explicit limits can exceed the former defaults", async () => {
  const f = fixture(65);
  await expect(f.execute({ ...f.input, timeoutMs: 60_000, maxOutputBytes: 32 * 1024 * 1024, maxPages: 80 })).resolves.toBe(1);
  expect(f.retire).not.toHaveBeenCalled();
});

test("omitting the execution timeout does not schedule a deadline", async () => {
  const f = fixture();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const timer = vi.spyOn(globalThis, "setTimeout");
  await expect(f.execute({ ...f.input, maxOutputBytes: 4 })).resolves.toBe(1);
  expect(timeout).not.toHaveBeenCalled();
  expect(timer).not.toHaveBeenCalled();
});

test("portable adapter unlimited sentinels leave all run-code budgets unlimited", async () => {
  const f = fixture(65);
  await expect(f.execute({ ...f.input, timeoutMs: Infinity, maxSourceBytes: Infinity,
    maxOutputBytes: Infinity, maxPages: Infinity, maxContexts: Infinity })).resolves.toBe(1);
  expect(f.retire).not.toHaveBeenCalled();
});

test("long explicit deadlines survive native timer overflow and clear after completion", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  try {
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<Awaited<ReturnType<typeof f.run>>>();
    f.run.mockImplementationOnce(() => { entered.resolve(); return completed.promise; });
    const outcome = f.execute({ ...f.input, timeoutMs: 2147483648 });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(2147483647);
    expect(f.retire).not.toHaveBeenCalled();
    completed.resolve({ ok: true, json: "1", stateJson: JSON.stringify(f.state) });
    await expect(outcome).resolves.toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("an explicit source byte limit is enforced before browser or guest access", async () => {
  const f = fixture();
  const source = '"界"';
  await expect(f.execute({ ...f.input, source, maxSourceBytes: 4 })).rejects.toThrow("source limit");
  expect(f.load).not.toHaveBeenCalled();
  expect(f.retire).not.toHaveBeenCalled();
  await expect(f.execute({ ...f.input, source, maxSourceBytes: 5 })).resolves.toBe(1);
});

test("host output rejection follows state restoration and retains the browser for recovery", async () => {
  const f = fixture();
  f.run.mockResolvedValueOnce({ ok: true, json: '"界"', stateJson: JSON.stringify(f.state) });
  await expect(f.execute({ ...f.input, maxOutputBytes: 4 })).rejects.toThrow("output limit");
  expect(restoreRunCodeContextState).toHaveBeenCalledWith(f.input.page.context(), f.state.context);
  expect(f.retire).not.toHaveBeenCalled();
  await expect(f.execute(f.input)).resolves.toBe(1);
});

test.each([0, -1, 1.5, NaN])("invalid optional budgets reject before acquisition (%s)", async (limit) => {
  const f = fixture();
  for (const name of ["timeoutMs", "maxOutputBytes", "maxSourceBytes", "maxPages", "maxContexts"])
    await expect(f.execute({ ...f.input, [name]: limit })).rejects.toThrow("Invalid run-code limit");
  expect(f.load).not.toHaveBeenCalled();
  expect(f.retire).not.toHaveBeenCalled();
});
