import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { discoverOAuthMetadata, OAuthMetadataError } from "./index.js";

it.each(["resolve", "reject"] as const)("settles rejected metadata before a host's late %s cleanup", async completion => {
  const cleanup = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), unhandled = vi.fn();
  const cancel = vi.fn(() => { entered.resolve(); return cleanup.promise; });
  const response = new Response(new ReadableStream({ cancel }), { status: 403 });
  let settled: unknown;
  process.on("unhandledRejection", unhandled);
  const pending = discoverOAuthMetadata("https://resource.example/mcp", { resourceMetadataUrl: "https://resource.example/metadata", fetch: async () => response })
    .catch(error => error).then(value => { settled = value; return value; });
  try {
    await entered.promise; await setImmediate();
    expect(OAuthMetadataError.is(settled)).toBe(true);
    expect(settled).toMatchObject({ phase: "protected-resource", status: 403 });
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    if (completion === "resolve") cleanup.resolve(); else cleanup.reject(new Error("late host cleanup failure"));
    await pending; await setImmediate();
    process.off("unhandledRejection", unhandled);
  }
  expect(unhandled).not.toHaveBeenCalled();
});

it("retains original caller cancellation while rejected metadata cleanup is pending", async () => {
  const cleanup = Promise.withResolvers<void>(), controller = new AbortController(), reason = { cancelled: "original caller" };
  const cancel = vi.fn(() => { controller.abort(reason); return cleanup.promise; });
  const response = new Response(new ReadableStream({ cancel }), { status: 403 });
  let settled: unknown;
  const pending = discoverOAuthMetadata("https://resource.example/mcp", { resourceMetadataUrl: "https://resource.example/metadata", signal: controller.signal, fetch: async () => response })
    .catch(error => error).then(value => { settled = value; return value; });
  try { await setImmediate(); expect(settled).toBe(reason); expect(cancel).toHaveBeenCalledOnce(); }
  finally { cleanup.resolve(); await pending; }
});
