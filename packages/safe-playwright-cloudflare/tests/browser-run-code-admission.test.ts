import { expect, test, vi } from "vitest";

vi.mock("../src/browser-page-cdp", () => ({
  browserPageCDP: async () => ({
    send: async () => ({
      targetInfo: { targetId: "owned-page", browserContextId: "owned-context" }
    })
  })
}));
vi.mock("../src/browser-run-code-native", () => ({
  runCodeContextOptions: () => ({}),
  captureRunCodeContextState: () => ({}),
  captureRunCodePageState: () => ({ targetId: "owned-page" }),
  captureRunCodeTimeouts: () => ({})
}));
vi.mock("../src/browser-run-code-relay", () => ({ createRunCodeRelay: vi.fn() }));
import { createBrowserRunCode } from "../src/browser-run-code";

test.each([
  {
    url: "about:blank",
    contextId: "private-context",
    contexts: ["owned-context", "private-context"]
  },
  {
    url: "https://example.com/private?token=secret",
    contextId: "private-context",
    contexts: ["owned-context", "private-context"]
  },
  { url: "", contextId: undefined, contexts: ["owned-context"] },
  { url: "data:text/html,secret", contextId: undefined, contexts: ["owned-context"] },
  {
    url: "https://example.com/stale?token=secret",
    contextId: "closed-context",
    contexts: ["owned-context"]
  }
])(
  "foreign admission records the census and retires before guest access ($url)",
  async ({ url, contextId, contexts }) => {
    const foreign = {
      targetId: "foreign-page",
      type: "page",
      browserContextId: contextId,
      url,
      title: "secret title"
    };
    const defaultTarget = { targetId: "startup-page", type: "page", url: "about:blank" };
    const detach = vi.fn(async () => {});
    const send = vi.fn(async (method: string) => {
      if (method === "Target.getTargets")
        return {
          targetInfos: [
            {
              targetId: "owned-page",
              type: "page",
              browserContextId: "owned-context",
              url: "about:blank"
            },
            defaultTarget,
            foreign
          ]
        };
      if (method === "Target.getBrowserContexts") return { browserContextIds: contexts };
      throw new Error(`Unexpected CDP method: ${method}`);
    });
    const retire = vi.fn(async () => {});
    const load = vi.fn();
    const connectSocket = vi.fn();
    const context = { pages: () => [page] };
    const page = { context: () => context };
    const execute = createBrowserRunCode({
      ownerId: "admission-test",
      browser: { newBrowserCDPSession: async () => ({ send, detach }) },
      loader: { load },
      guestSource: "",
      connectSocket,
      retire
    } as never);
    const error = await execute({
      page,
      source: "async page => 1n",
      signal: new AbortController().signal,
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      maxPages: 4
    } as never).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    const prefix = "Run-code cannot reconnect another existing browser context: ";
    expect(error.message.startsWith(prefix)).toBe(true);
    expect(JSON.parse(error.message.slice(prefix.length))).toEqual({
      ownedTargetId: "owned-page",
      ownedContextId: "owned-context",
      browserContextIds: contexts,
      foreignTargets: [
        {
          targetId: "startup-page",
          contextId: null,
          type: "page",
          urlState: "about:blank",
          isPrivateContext: false
        },
        {
          targetId: "foreign-page",
          contextId: contextId ?? null,
          type: "page",
          urlState: url === "" ? "empty" : url === "about:blank" ? "about:blank" : "other",
          isPrivateContext: contextId !== undefined && contexts.includes(contextId)
        }
      ]
    });
    expect(error.message).not.toContain("secret");
    expect(retire).toHaveBeenCalledOnce();
    expect(detach).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(connectSocket).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Target.getTargets",
      "Target.getBrowserContexts"
    ]);
  }
);
