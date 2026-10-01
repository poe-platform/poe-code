import { expect, it, vi } from "vitest";
import { OAuthAuthorizationError, OAuthError } from "mcp-oauth";
import { errorDetails } from "./commands.js";
it("summarizes known OAuth failures without mutating the SDK error", () => {
  const error = new OAuthError({ error: "invalid_client", error_description: "private-description", error_uri: "https://auth.example/private-uri" }, 400);
  expect(errorDetails(error)).toEqual({ name: "OAuthError", message: "OAuth invalid_client (HTTP 400)", status: 400, oauthError: "invalid_client", retryable: false, terminal: true, outcomeKnown: true });
  expect(error.message).toBe("private-description"); expect(error.errorUri).toBe("https://auth.example/private-uri");
});
it("withholds unknown extension codes that could reflect credentials", () => {
  const error = new OAuthError({ error: "private-reflected-token", error_description: "private-description" }, 403);
  const details = errorDetails(error);
  expect(JSON.stringify(details)).not.toContain("private-");
  expect(details).toMatchObject({ message: "OAuth request failed (HTTP 403)", status: 403, outcomeKnown: true });
});
it("retains safe status details for malformed OAuth error responses", () => {
  expect(errorDetails(new OAuthError({ error: "invalid_response" }, 403, false))).toMatchObject({ status: 403, oauthError: "invalid_response", outcomeKnown: false, retryable: false });
});
it("sanitizes OAuth errors inside aggregate causes and leaves normal MCP details intact", () => {
  const error = new OAuthError({ error: "invalid_grant", error_description: "private-description" }, 400);
  const details = errorDetails(new AggregateError([new OAuthError({ error: "invalid_grant", error_description: "private-description" }, 400)], "Connection failed", { cause: error }));
  expect(JSON.stringify(details)).not.toContain("private-");
  expect(details).toMatchObject({ message: "Connection failed", cause: { status: 400, oauthError: "invalid_grant" }, errors: [{ status: 400, oauthError: "invalid_grant" }] });
});
it.each(["access_denied", "private-reflected-code"])("preserves SDK callback diagnostics while sanitizing nested CLI authorization error %s", code => {
  const error = new OAuthAuthorizationError(code, "private-reflected-description");
  expect(JSON.stringify(errorDetails(new AggregateError([error], "Authorization failed", { cause: error })))).not.toContain("private-");
  expect(error.error).toBe(code);
  expect(error.errorDescription).toBe("private-reflected-description");
  expect(error.message).toBe(`OAuth authorization failed: ${code} — private-reflected-description`);
});

it.each(["token", "callback"] as const)("sanitizes a %s OAuth error from an independent native module copy", async phase => {
  vi.resetModules();
  const foreign = await import("mcp-oauth");
  expect(foreign.OAuthError).not.toBe(OAuthError);
  expect(foreign.OAuthAuthorizationError).not.toBe(OAuthAuthorizationError);
  const error = phase === "token"
    ? new foreign.OAuthError({ error: "invalid_client", error_description: "private-reflected-description" }, 400)
    : new foreign.OAuthAuthorizationError("access_denied", "private-reflected-description");
  const cause = phase === "token"
    ? new foreign.OAuthError({ error: "invalid_client", error_description: "private-reflected-description" }, 400)
    : new foreign.OAuthAuthorizationError("access_denied", "private-reflected-description");
  const details = errorDetails(new AggregateError([error], "Authorization failed", { cause }));
  expect(JSON.stringify(details)).not.toContain("private-");
  expect(details).toMatchObject({ cause: { oauthError: phase === "token" ? "invalid_client" : "access_denied" },
    errors: [{ oauthError: phase === "token" ? "invalid_client" : "access_denied" }] });
  expect(error.message).toContain("private-reflected-description");
});

it.each(["OAuthError", "OAuthAuthorizationError"])("does not classify an ordinary failure by its mutable %s name", name => {
  const error = Object.assign(new Error("original host failure"), { name, error: "access_denied", errorDescription: "host details" });
  expect(OAuthError.is(error)).toBe(false);
  expect(OAuthAuthorizationError.is(error)).toBe(false);
  expect(errorDetails(error)).toEqual({ name, message: "original host failure" });
});
