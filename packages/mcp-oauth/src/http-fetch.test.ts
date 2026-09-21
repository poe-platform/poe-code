import { expect, it, vi } from "vitest";
import { fetchMcpResponse } from "./http-fetch.js";

it.each(["redirected", "opaqueredirect"])("rejects %s responses even when body cancellation stalls", async (kind) => {
  let completeCancellation!: () => void;
  const cancellation = new Promise<void>((resolve) => { completeCancellation = resolve; });
  const cancel = vi.fn(() => cancellation);
  const response = new Response(new ReadableStream({ cancel }));
  Object.defineProperty(response, kind === "redirected" ? "redirected" : "type", {
    value: kind === "redirected" ? true : "opaqueredirect"
  });
  let failure: unknown;
  const operation = fetchMcpResponse(async () => response, "https://example.test/metadata")
    .catch((error) => { failure = error; });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledOnce();
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("redirect");
  } finally {
    completeCancellation();
    await operation;
  }
});

it("settles cancellation even when an injected fetch ignores its signal and discards a late body", async () => {
  const controller = new AbortController(), reason = new Error("cancel request"), response = Promise.withResolvers<Response>();
  const cancel = vi.fn();
  const operation = fetchMcpResponse(async () => response.promise, "https://example.test/metadata", { signal: controller.signal })
    .then(() => "completed", (error: unknown) => error);
  controller.abort(reason);
  try {
    expect(await Promise.race([operation, new Promise(resolve => setImmediate(() => resolve("still pending")))])).toBe(reason);
  } finally {
    response.resolve(new Response(new ReadableStream({ cancel })));
    await operation;
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(cancel).toHaveBeenCalledOnce();
});

it("refuses an already canceled fetch before invoking the host", async () => {
  const controller = new AbortController(), reason = new Error("already cancelled"); controller.abort(reason);
  const fetch = vi.fn(async () => new Response());
  await expect(fetchMcpResponse(fetch, "https://example.test", { signal: controller.signal })).rejects.toBe(reason);
  expect(fetch).not.toHaveBeenCalled();
});

it("observes a late rejected host fetch without replacing the cancellation reason", async () => {
  const controller = new AbortController(), reason = new Error("cancel request"), response = Promise.withResolvers<Response>();
  const operation = fetchMcpResponse(async () => response.promise, "https://example.test", { signal: controller.signal }).catch((error: unknown) => error);
  controller.abort(reason);
  try {
    expect(await Promise.race([operation, new Promise(resolve => setImmediate(() => resolve("still pending")))])).toBe(reason);
  } finally { response.reject(new Error("late host failure")); await operation; }
});
it.each(["success", "async failure", "sync failure"])("removes request abort listeners after %s", async mode => {
  const controller = new AbortController(), failure = new Error("host failure");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const fetch = () => {
    if (mode === "sync failure") throw failure;
    return mode === "async failure" ? Promise.reject(failure) : Promise.resolve(new Response());
  };
  const operation = fetchMcpResponse(fetch, "https://example.test", { signal: controller.signal });
  if (mode === "success") expect(await operation).toBeInstanceOf(Response);
  else await expect(operation).rejects.toBe(failure);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});
