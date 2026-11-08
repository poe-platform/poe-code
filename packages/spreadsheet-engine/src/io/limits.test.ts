import { expect, it } from "vitest";
import { createResourceIO } from "./index.js";

const filesystem = { async read() { return []; }, async write() {} };

it.each([Infinity, 2, 1, 0])("enforces the configured redirect budget %s", async redirects => {
  const authorized: string[] = [];
  const requested: string[] = [];
  const bytes = new Uint8Array([42]);
  const io = createResourceIO({ cwd: "/", filesystem, transport: {
    redirects,
    async authorize(uri) { authorized.push(uri); },
    async request(uri) {
      requested.push(uri);
      return requested.length <= 2 ? { redirect: `/hop${requested.length}` } : { source: [bytes] };
    }
  } });
  const result = io.read("https://example.test/start", new AbortController().signal);
  if (redirects >= 2) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of await result) chunks.push(chunk);
    expect(chunks).toEqual([bytes]);
  }
  else await expect(result).rejects.toMatchObject({ code: "resource-limit" });
  expect(requested).toHaveLength(Math.min(redirects + 1, 3));
  expect(authorized).toEqual(requested);
});

it.each([-Infinity, NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid redirect budget %s", redirects => {
  expect(() => createResourceIO({ cwd: "/", filesystem, transport: {
    redirects, async authorize() {}, async request() { return {}; }
  } })).toThrow("Invalid ssconvert redirect limit");
});

it.each(["denial", "abort"])("unlimited redirects still honor %s at each hop", async mode => {
  const controller = new AbortController();
  const reason = new Error(mode);
  const requested: string[] = [];
  const io = createResourceIO({ cwd: "/", filesystem, transport: {
    redirects: Infinity,
    async authorize(uri) {
      if (uri.endsWith("/next")) {
        if (mode === "denial") throw reason;
        controller.abort(reason);
      }
    },
    async request(uri) { requested.push(uri); return { redirect: "/next" }; }
  } });
  await expect(io.read("https://example.test/start", controller.signal)).rejects.toBe(reason);
  expect(requested).toEqual(["https://example.test/start"]);
});
