import { expect, it } from "vitest";
import { OAuthError } from "mcp-oauth";
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
