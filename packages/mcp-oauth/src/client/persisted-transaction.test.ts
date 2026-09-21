import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createAuthStoreSessionStore } from "./auth-store-session-store.js";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { StoredOAuthSession } from "./types.js";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});

it("redeems a rotating refresh token once across independent persisted store/provider instances", async () => {
  const resource = "https://resource.example/mcp", issuer = "https://auth.example";
  const fs = createFsFromVolume(new Volume()).promises;
  const options = { backend: "file" as const, fileStore: { fs, salt: "transaction-fixture", filePath: "/home/test/session.enc",
    getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const initial: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "client" },
    tokens: { accessToken: "expired", refreshToken: "one-use-refresh", tokenType: "Bearer", expiresAt: 0 },
    discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
    } } };
  await createAuthStoreSessionStore(options).save(resource, initial);
  const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  let redemptions = 0;
  const fetch = vi.fn(async () => {
    if (++redemptions > 1) throw new Error("refresh replay");
    entered.resolve(); await finish.promise;
    return Response.json({ access_token: "winner", refresh_token: "winner-refresh", token_type: "Bearer", expires_in: 3600 });
  });
  const authorize = async () => {
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {}, allowInteractive: false, authStore: options, now: () => 1000 });
    const headers = new Headers(); await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }); return headers.get("Authorization");
  };
  const first = authorize();
  await entered.promise;
  const second = authorize();
  finish.resolve();
  expect(await Promise.all([first, second])).toEqual(["Bearer winner", "Bearer winner"]);
  expect(fetch).toHaveBeenCalledOnce();
  expect((await createAuthStoreSessionStore(options).load(resource))?.tokens?.refreshToken).toBe("winner-refresh");
});
