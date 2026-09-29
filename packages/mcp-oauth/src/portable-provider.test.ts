import { expect, it } from "vitest";
import { createOAuthClientProvider, createDefaultOAuthClientProvider, createAuthStoreSessionStore, OAuthAuthorizationError } from "./index.browser.js";
import { OAuthAuthorizationError as DesktopAuthorizationError } from "./client/loopback-authorization.js";

it("retains the host-owned OAuth provider", () => {
  const provider = { authorizeRequest: async () => {}, handleUnauthorized: async () => ({ action: "fail" as const }) };
  expect(createOAuthClientProvider({ provider })).toBe(provider);
});
it("rejects desktop OAuth and persistence explicitly", () => {
  expect(() => createOAuthClientProvider({ browser: {} })).toThrow("host-owned");
  expect(createDefaultOAuthClientProvider).toThrow("Desktop OAuth");
  expect(createAuthStoreSessionStore).toThrow("persistence");
});
it("recognizes authorization errors across desktop and remote entries", () => {
  expect(DesktopAuthorizationError.is(new OAuthAuthorizationError("denied", "synthetic"))).toBe(true);
  expect(OAuthAuthorizationError.is(new Error("unbranded"))).toBe(false);
  expect(OAuthAuthorizationError.is(new DesktopAuthorizationError("denied", "synthetic"))).toBe(true);
});
