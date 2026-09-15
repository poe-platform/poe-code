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
