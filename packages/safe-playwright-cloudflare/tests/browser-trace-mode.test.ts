import { expect, test, vi } from "vitest";
import { createCloudflarePlaywrightAdapter } from "../src/index.js";
import { createPlaywrightAdapter } from "@poe-platform/safe-bash/playwright";

vi.mock("@poe-platform/safe-bash/playwright", async importOriginal => ({
  ...await importOriginal<typeof import("@poe-platform/safe-bash/playwright")>(),
  createPlaywrightAdapter: vi.fn(() => ({ acquire: vi.fn() })),
}));
vi.mock("../src/shell-browser-resource.js", () => ({
  acquireCloudflareBrowser: async () => ({
    browser: { isConnected() { return true; }, on() {}, off() {} },
    prepareSnapshots() {}, prepareStorageOrigin() {}, interrupt() {}, release() {},
  }),
}));
vi.mock("../src/browser-code-executor.js", () => ({ createBrowserCodeExecutor: () => async () => "" }));
vi.mock("../src/browser-codegen.js", () => ({ generateBrowserActionCode() {} }));

test.each([undefined, "live", "archive"] as const)("Cloudflare trace mode %s preserves artifact capture and only selects live capture explicitly", async traceCapture => {
  createCloudflarePlaywrightAdapter({} as Parameters<typeof createCloudflarePlaywrightAdapter>[0],
    undefined, undefined, traceCapture === undefined ? {} : { traceCapture });
  const configuration = vi.mocked(createPlaywrightAdapter).mock.calls.at(-1)![0];
  const resource = await configuration.chromium!.acquireBrowser!({ signal: new AbortController().signal });
  expect(typeof resource.captureArtifact).toBe("function");
  expect(typeof resource.captureTrace).toBe(traceCapture === "archive" ? "undefined" : "function");
});

test("invalid Cloudflare trace modes reject before creating an adapter", () => {
  vi.mocked(createPlaywrightAdapter).mockClear();
  expect(() => createCloudflarePlaywrightAdapter(undefined, undefined, undefined,
    { traceCapture: "automatic" } as unknown as Parameters<typeof createCloudflarePlaywrightAdapter>[3]))
    .toThrow("Invalid Cloudflare trace capture mode");
  expect(createPlaywrightAdapter).not.toHaveBeenCalled();
});
