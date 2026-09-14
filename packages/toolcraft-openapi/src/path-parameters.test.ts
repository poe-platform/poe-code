import { describe, expect, it, vi } from "vitest";
import { UserError } from "toolcraft";
import { requestJson, type HttpRequestOptions } from "./http.js";

interface PathCase {
  path: string;
  pathParams: NonNullable<HttpRequestOptions["pathParams"]>;
  expectedPath?: string;
}

const unsafe: PathCase[] = [
  { path: "/items/{id}", pathParams: { id: "." } },
  { path: "/items/{id}", pathParams: { id: ".." } },
  { path: "/items/{id}/detail", pathParams: { id: ".." } },
  { path: "/{left}{right}/detail", pathParams: { left: ".", right: "." } },
  { path: "/items/%2e{id}", pathParams: { id: "." } },
  { path: "/items/{id}%2E", pathParams: { id: "." } },
  { path: "/items/%2E{id}", pathParams: { id: "" } },
  { path: "/items\\{id}", pathParams: { id: ".." } },
  { path: "/items\\extra\\{id}\\detail", pathParams: { id: ".." } },
  { path: "/items/\n{id}/detail", pathParams: { id: ".." } },
  { path: "/items/\t{id}/detail", pathParams: { id: ".." } },
  { path: "/items/{id}/../health", pathParams: { id: "." } }
];

const safe: PathCase[] = [
  { path: "/items/{id}.json", pathParams: { id: ".." }, expectedPath: "/items/...json" },
  { path: "/items/prefix{id}", pathParams: { id: ".." }, expectedPath: "/items/prefix.." },
  { path: "/items/{id}", pathParams: { id: "%2e" }, expectedPath: "/items/%252e" },
  { path: "/items/{id}", pathParams: { id: "team/red" }, expectedPath: "/items/team%2Fred" },
  { path: "/items/{id}", pathParams: { id: "team\\red" }, expectedPath: "/items/team%5Cred" },
  { path: "/items/{id}", pathParams: { id: "..." }, expectedPath: "/items/..." },
  { path: "/items/{id}", pathParams: { id: "" }, expectedPath: "/items/" },
  { path: "/items/{id}", pathParams: { id: 0 }, expectedPath: "/items/0" },
  { path: "/items/{id}", pathParams: { id: false }, expectedPath: "/items/false" },
  { path: "/items/{id}", pathParams: { id: "a?b#c" }, expectedPath: "/items/a%3Fb%23c" },
  { path: "/items/{id}/../health", pathParams: { id: "ordinary" }, expectedPath: "/items/health" },
  { path: "/items/../health", pathParams: {}, expectedPath: "/health" },
  { path: "items/{id}", pathParams: { id: "sample" }, expectedPath: "/items/sample" }
];

describe.each(["https://api.example.test", "https://api.example.test/v1/", "http://api.example.test/v1"])("path substitution under %s", (baseUrl) => {
  describe.each(["GET", "POST"])("%s", (method) => {
    it.each(unsafe)("rejects route-changing $path with $pathParams before transport", async ({ path, pathParams }) => {
      const fetch = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
      const getToken = vi.fn(async () => "unused");
      const createKey = vi.fn(() => "unused-key");
      await expect(requestJson({
        baseUrl, path, pathParams, method, fetch,
        auth: "none", tokenSource: { getToken },
        idempotency: { enabled: true, header: "Idempotency-Key", createKey }
      })).rejects.toSatisfy((error: unknown) => error instanceof UserError && error.message.includes("dot-only"));
      expect(fetch).not.toHaveBeenCalled();
      expect(getToken).not.toHaveBeenCalled();
      expect(createKey).not.toHaveBeenCalled();
    });

    it.each(safe)("preserves valid $path with $pathParams", async ({ path, pathParams, expectedPath }) => {
      const fetch = vi.fn(async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }));
      await expect(requestJson({
        baseUrl, path, pathParams, method, fetch,
        auth: "none", tokenSource: { getToken: vi.fn() }
      })).resolves.toEqual({ ok: true });
      const prefix = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`${prefix}${expectedPath}`, expect.objectContaining({ method }));
    });
  });
});

it("reads and serializes each path parameter once while preserving base query and fragment", async () => {
  const read = vi.fn(() => "sample");
  const pathParams = Object.defineProperty({}, "id", { get: read });
  const fetch = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  await requestJson({
    baseUrl: "https://api.example.test/v1?existing=value#anchor",
    path: "/items/{id}", pathParams, method: "GET", fetch,
    auth: "none", tokenSource: { getToken: vi.fn() }, query: { query: "two words" }
  });
  expect(read).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://api.example.test/v1/items/sample?existing=value&query=two+words#anchor",
    expect.any(Object)
  );
});
