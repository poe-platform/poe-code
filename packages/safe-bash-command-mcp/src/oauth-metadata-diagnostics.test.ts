import { expect, it, vi } from "vitest";
import { discoverOAuthMetadata, OAuthMetadataError } from "tiny-mcp-client";
import { errorDetails } from "./commands.js";

it.each(["resource", "issuer"] as const)("retains SDK metadata %s mismatch details while withholding reflected values from CLI diagnostics", async mode => {
  const resource = "https://resource.example/mcp", issuer = "https://auth.example";
  const failure = await discoverOAuthMetadata(resource, { resourceMetadataUrl: `${resource}/metadata`, fetch: async input => {
    if (String(input) === `${resource}/metadata`) return Response.json({ resource: mode === "resource" ? `${resource}?reflected=private-credential` : resource, authorization_servers: [issuer] });
    return Response.json({ issuer: `${issuer}/private-credential`, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
  } }).catch(error => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain("private-credential");
  expect(JSON.stringify(errorDetails(failure))).not.toContain("private-credential");
  expect(errorDetails(failure)).toMatchObject({ name: "OAuthMetadataError", message: mode === "resource" ? "OAuth protected resource metadata failed" : "OAuth authorization server metadata failed",
    phase: mode === "resource" ? "protected-resource" : "authorization-server" });
});

it.each([403, 502])("retains SDK HTTP %s metadata status/diagnostics while withholding reflected reason phrases from CLI", async status => {
  const resource = "https://resource.example/mcp";
  const failure = await discoverOAuthMetadata(resource, { resourceMetadataUrl: `${resource}/metadata`,
    fetch: async () => new Response("private-body", { status, statusText: "private-reflected-reason" }) }).catch(error => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain("private-reflected-reason");
  expect(JSON.stringify(errorDetails(failure))).not.toContain("private-");
  expect(failure.status).toBe(status);
  expect(errorDetails(failure)).toEqual({ name: "OAuthMetadataError", phase: "protected-resource", status,
    message: `OAuth protected resource metadata failed (HTTP ${status})` });
});

it("recognizes separately bundled native metadata diagnostics inside aggregate causes", async () => {
  vi.resetModules();
  const foreign = await import("tiny-mcp-client");
  expect(foreign.OAuthMetadataError).not.toBe(OAuthMetadataError);
  const cause = new foreign.OAuthMetadataError("protected-resource", "private-reflected-resource");
  const nested = new foreign.OAuthMetadataError("authorization-server", "private-reflected-issuer");
  expect(OAuthMetadataError.is(cause)).toBe(true);
  const details = errorDetails(new AggregateError([nested], "Metadata unavailable", { cause }));
  expect(JSON.stringify(details)).not.toContain("private-");
  expect(details).toMatchObject({ cause: { phase: "protected-resource" }, errors: [{ phase: "authorization-server" }] });
  expect(cause.message).toBe("private-reflected-resource");
});

it("withholds malformed metadata phases and preserves ordinary same-named host errors", () => {
  const malformed = Object.assign(new OAuthMetadataError("protected-resource", "private-diagnostic"), { phase: "private-reflected-phase", status: "private-reflected-status" });
  expect(errorDetails(malformed)).toEqual({ name: "OAuthMetadataError", message: "OAuth metadata failed" });
  const host = Object.assign(new Error("original host diagnostic"), { name: "OAuthMetadataError", phase: "protected-resource" });
  expect(OAuthMetadataError.is(host)).toBe(false);
  expect(errorDetails(host)).toEqual({ name: "OAuthMetadataError", message: "original host diagnostic" });
});
