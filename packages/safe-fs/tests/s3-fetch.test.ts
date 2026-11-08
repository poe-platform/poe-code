import { afterEach, expect, it, vi } from "vitest";
import { sendRequest } from "../src/fs/s3/http/request-fetch.js";
import { collect, scopeFor } from "../src/fs/s3/http/request.js";

const options = { protocol: "https:", hostname: "s3.example", path: "/bucket/file", method: "GET", headers: {} };
afterEach(() => vi.unstubAllGlobals());

it("bounds streamed fetch bytes and cancels oversized responses", async () => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(0, 128, 255)); }, cancel,
  }))));
  const response = await sendRequest(options, new Uint8Array(), scopeFor(undefined, undefined));
  await expect(collect(response, 2)).rejects.toMatchObject({ code: "EntityTooLarge" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("aborts pending body reads and closes the stream", async () => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }))));
  const controller = new AbortController();
  const response = await sendRequest(options, new Uint8Array(), scopeFor(controller.signal, undefined));
  const pending = collect(response, 10);
  const reason = new Error("cancelled");
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(cancel).toHaveBeenCalledOnce();
});

it("rejects normalized dot-segment keys before fetch and preserves literal percent keys", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await expect(sendRequest({ ...options, path: "/bucket/a/../file" }, new Uint8Array(), scopeFor(undefined, undefined)))
    .rejects.toMatchObject({ code: "InvalidArgument" });
  expect(fetch).not.toHaveBeenCalled();
  const response = await sendRequest({ ...options, path: "/bucket/%252E%252E/file" }, new Uint8Array(), scopeFor(undefined, undefined));
  response.close();
  expect(fetch.mock.calls[0]?.[0]).toBe("https://s3.example/bucket/%252E%252E/file");
});

it("preserves redirect status for the transport to reject without following it", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 307, headers: { location: "https://other.example" } }));
  vi.stubGlobal("fetch", fetch);
  const response = await sendRequest(options, new Uint8Array(), scopeFor(undefined, undefined));
  expect(response.message.statusCode).toBe(307);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  response.close();
});
