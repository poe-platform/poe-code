import { expect, it, vi } from "vitest";
import { discoverOAuthMetadata, OAuthMetadataError } from "./index.js";

const resource = "https://resource.example/mcp";
const issuer = "https://issuer.example";
const valid = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] };
const resourceResponse = async () => Response.json({ resource, authorization_servers: [issuer] });

it.each([
  [{ issuer: "https://private.example" }, "issuer-mismatch"],
  [{ code_challenge_methods_supported: ["plain"] }, "pkce-unsupported"],
  [{ response_types_supported: ["token"] }, "response-type-unsupported"],
  [{ token_endpoint: "http://private.example/token" }, "invalid-endpoint"],
  [{ token_endpoint: "private endpoint" }, "invalid-endpoint"],
] as const)("preserves validation reason %s across HTTP fallback", async (override, reason) => {
  const fetch = vi.fn().mockImplementationOnce(resourceResponse)
    .mockImplementationOnce(async () => Response.json({ ...valid, ...override }))
    .mockImplementation(async () => new Response("private response", { status: 503 }));
  const error = await discoverOAuthMetadata(resource, { fetch }).catch(error => error);
  expect(OAuthMetadataError.is(error)).toBe(true);
  expect(error).toMatchObject({ category: "validation", reason, failures: [
    { category: "validation", reason }, { category: "http", reason: "http-error", status: 503 }
  ] });
  expect(JSON.stringify(error.failures)).not.toContain("private");
});

it.each(["json", "http", "network"] as const)("preserves %s failures", async category => {
  const fetch = vi.fn().mockImplementationOnce(resourceResponse).mockImplementation(async () => {
    if (category === "network") throw new Error("private network details");
    return new Response("private invalid JSON", { status: category === "http" ? 503 : 200 });
  });
  await expect(discoverOAuthMetadata(resource, { fetch })).rejects.toMatchObject({
    category, reason: { json: "invalid-json", http: "http-error", network: "network-error" }[category],
    ...(category === "http" ? { status: 503 } : {})
  });
});

it("returns successful OIDC fallback after invalid RFC8414 metadata", async () => {
  const fetch = vi.fn().mockImplementationOnce(resourceResponse)
    .mockImplementationOnce(async () => Response.json({ ...valid, issuer: "wrong" }))
    .mockImplementationOnce(async () => Response.json(valid));
  await expect(discoverOAuthMetadata(resource, { fetch })).resolves.toMatchObject({ authorizationServerMetadata: valid });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("preserves caller cancellation without fallback", async () => {
  const controller = new AbortController(), reason = { cancelled: true };
  const fetch = vi.fn().mockImplementationOnce(resourceResponse).mockImplementation(async () => {
    controller.abort(reason); throw reason;
  });
  await expect(discoverOAuthMetadata(resource, { fetch, signal: controller.signal })).rejects.toBe(reason);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["protected-resource", "authorization-server"] as const)("classifies malformed JSON in %s", async phase => {
  const fetch = vi.fn().mockImplementation(async () => new Response("private JSON"));
  if (phase === "authorization-server") fetch.mockImplementationOnce(resourceResponse);
  await expect(discoverOAuthMetadata(resource, { fetch })).rejects.toMatchObject({ phase, category: "json", reason: "invalid-json" });
});

it("retains a validation defect found only in OIDC fallback", async () => {
  const fetch = vi.fn().mockImplementationOnce(resourceResponse)
    .mockImplementationOnce(async () => new Response(null, { status: 404 }))
    .mockImplementationOnce(async () => Response.json({ ...valid, code_challenge_methods_supported: [] }));
  await expect(discoverOAuthMetadata(resource, { fetch })).rejects.toMatchObject({ category: "validation", reason: "pkce-unsupported",
    failures: [{ category: "http", status: 404 }, { category: "validation", reason: "pkce-unsupported" }] });
});

it("does not classify a host cache write failure as invalid provider metadata", async () => {
  const failure = new Error("host cache unavailable");
  const fetch = vi.fn().mockImplementationOnce(resourceResponse).mockImplementation(async () => Response.json(valid));
  await expect(discoverOAuthMetadata(resource, { fetch, cache: { get: () => undefined, set: () => { throw failure; } } })).rejects.toBe(failure);
  expect(fetch).toHaveBeenCalledTimes(2);
});
