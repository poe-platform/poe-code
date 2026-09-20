import { expect, test, vi } from "vitest";
import { acquire } from "@cloudflare/playwright";
import worker from "./browser-run-code.test.worker";

vi.mock("@cloudflare/playwright", () => ({ acquire: vi.fn(), connect: vi.fn() }));
vi.mock("../src/browser-run-code", () => ({ createBrowserRunCode: vi.fn() }));
vi.mock("./browser-storage-route.test.worker-cases", () => ({ handleBrowserStorageScenario: vi.fn() }));

test("native run-code failure responses preserve nested cleanup errors", async () => {
  vi.mocked(acquire).mockRejectedValueOnce(new AggregateError([
    new AggregateError([new Error("socket close confirmation missing")], "Run-code socket cleanup failed"),
    new Error("receiver close rejected"),
  ], "Run-code transport cleanup failed"));
  const response = await worker.fetch(new Request("http://localhost/context"), {
    BROWSER: {} as never,
    BROWSER_RUN_CODE_LOADER: {} as never,
  });
  expect(response.status).toBe(500);
  const body = await response.json() as { error: string };
  expect(body.error).toContain("Run-code transport cleanup failed");
  expect(body.error).toContain("Run-code socket cleanup failed");
  expect(body.error).toContain("socket close confirmation missing");
  expect(body.error).toContain("receiver close rejected");
});
