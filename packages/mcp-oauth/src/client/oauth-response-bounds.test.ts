import { expect, it, vi } from "vitest";
import { readOAuthJsonObjectResponse } from "./token-endpoint.js";

it("cancels OAuth bodies whose declared size exceeds the limit", async () => {
  const response = new Response('{}', { headers: { "content-length": "2097152" } });
  const cancel = vi.spyOn(response.body!, "cancel");
  await expect(readOAuthJsonObjectResponse(response)).rejects.toThrow("1048576 bytes");
  expect(cancel).toHaveBeenCalledOnce();
});

it("bounds streamed OAuth JSON bytes and releases the reader", async () => {
  const cancel = vi.fn();
  const chunk = new TextEncoder().encode(" ".repeat(400_000));
  let pulls = 0;
  const response = new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(chunk); if (pulls === 5) controller.close(); },
    cancel
  }));
  await expect(readOAuthJsonObjectResponse(response)).rejects.toThrow("1048576 bytes");
  expect(cancel).toHaveBeenCalledOnce();
  expect(response.body?.locked).toBe(false);
});

it("rejects malformed UTF-8 rather than replacing token bytes", async () => {
  const bytes = new Uint8Array([123, 34, 116, 34, 58, 34, 255, 34, 125]);
  await expect(readOAuthJsonObjectResponse(new Response(bytes))).rejects.toThrow("JSON object");
});
