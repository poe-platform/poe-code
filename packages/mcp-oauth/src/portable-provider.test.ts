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
it("preserves authorization error identity across desktop and remote entries", () => {
  expect(OAuthAuthorizationError).toBe(DesktopAuthorizationError);
  expect(OAuthAuthorizationError.is(new DesktopAuthorizationError("denied", "synthetic"))).toBe(true);
});
