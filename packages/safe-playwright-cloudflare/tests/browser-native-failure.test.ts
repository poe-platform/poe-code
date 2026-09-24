import { expect, test, vi } from "vitest";
import { acquire } from "@cloudflare/playwright";
import assert from "node:assert/strict";
import { failureText } from "./browser-native-failure";
import worker from "./browser-run-code.test.worker";

vi.mock("@cloudflare/playwright", () => ({ acquire: vi.fn(), connect: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));
vi.mock("../src/browser-run-code", () => ({ createBrowserRunCode: vi.fn() }));
vi.mock("./browser-storage-route.test.worker-cases", () => ({ handleBrowserStorageScenario: vi.fn() }));

test("serialization assertion diagnostics retain the original transport failure and native cause", async () => {
  const transport = new AggregateError([
    new Error("socket confirmation failed", { cause: new Error("Network connection lost.") }),
    new Error("receiver RPC disconnected"),
  ], "Run-code transport cleanup failed");
  const assertion = await assert.rejects(
    Promise.reject(transport), /result is not JSON-serializable/
  ).catch((error: unknown) => error);
  const text = failureText(assertion);
  expect(text).toContain("socket confirmation failed");
  expect(text).toContain("Network connection lost.");
  expect(text).toContain("receiver RPC disconnected");
});

test("failure diagnostics visit shared and cyclic causes once", () => {
  const cause = new Error("native failure");
  const error = new AggregateError([cause, cause], "cleanup failed", { cause });
  cause.cause = error;
  expect(failureText(error)).toBe("AggregateError: cleanup failed; Error: native failure");
});

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
