# MCP OAuth Refresh Save Failure Still Activates Unpersisted Access Token

## Summary

The exported `mcp-oauth` default provider updates its in-memory session cache before it durably saves refreshed tokens. If session persistence rejects, `handleUnauthorized()` reports failure but the same provider instance subsequently authorizes requests using the newly refreshed access token that callers were told failed to save.

## Reproduction

Create a disposable Vitest probe at `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";

import {
  createDefaultOAuthClientProvider,
  type OAuthDiscoveryResult,
  type OAuthSessionStore,
  type StoredOAuthSession
} from "./index.js";

const resource = "https://resource.example.com/mcp";
const authorizationServer = "https://auth.example.com";
const discovery: OAuthDiscoveryResult = {
  resource,
  resourceMetadataUrl: "https://resource.example.com/.well-known/oauth-protected-resource/mcp",
  resourceMetadata: { resource, authorization_servers: [authorizationServer] },
  authorizationServer,
  authorizationServerMetadataUrl: `${authorizationServer}/.well-known/oauth-authorization-server`,
  authorizationServerMetadata: {
    issuer: authorizationServer,
    authorization_endpoint: `${authorizationServer}/authorize`,
    token_endpoint: `${authorizationServer}/token`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"]
  }
};

it("uses a refreshed token cached before failed session persistence", async () => {
  const stored: StoredOAuthSession = {
    resource,
    client: { clientId: "client" },
    discovery,
    tokens: { accessToken: "expired", tokenType: "Bearer", expiresAt: 0, refreshToken: "refresh-old" }
  };
  const sessionStore: OAuthSessionStore = {
    load: vi.fn(async () => stored),
    save: vi.fn(async () => { throw new Error("session disk full"); }),
    clear: vi.fn(async () => undefined)
  };
  const provider = createDefaultOAuthClientProvider({ sessionStore, now: () => 1 });
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    access_token: "uncommitted-access",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: "refresh-new"
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  await expect(provider.handleUnauthorized!({
    requestUrl: resource,
    discovery,
    challenge: { scheme: "Bearer", params: { error: "invalid_token" }, raw: "Bearer error=invalid_token" },
    fetch
  })).resolves.toMatchObject({ action: "fail", error: expect.any(Error) });

  const headers = new Headers();
  await provider.authorizeRequest!({ requestUrl: resource, headers, fetch });
  expect(headers.get("Authorization")).toBe("Bearer uncommitted-access");
});
```

Run:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/mcp-oauth/src/__probe__.test.ts > uses a refreshed token cached before failed session persistence
```

Remove the disposable probe after validation.

## Observed Behavior

During refresh, `refreshSession()` obtains updated tokens and awaits `saveSession()` before returning at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:136` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:212`. However, `saveSession()` first inserts the replacement session into the provider's `sessions` map and only then awaits durable `sessionStore.save()` at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:415` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:428`. In the probe, the persistence call rejects, causing `handleUnauthorized()` to return `{ action: "fail" }`; a subsequent `authorizeRequest()` loads the cached session and emits `Authorization: Bearer uncommitted-access` through the fresh-token fast path at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:105` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:133`.

## Expected Behavior

If refreshed OAuth session persistence fails and the refresh is reported as failed, the provider should not begin using that unpersisted replacement credential as active session state. It should commit in-memory state only after durable save succeeds, or expose a success result that accurately communicates the active transient credential state.

## Impact

Callers can receive an OAuth-refresh failure and make retry, relogin, or incident decisions assuming no new token became active, while the same running process silently sends the new bearer token on later requests. This creates inconsistent authentication state across process restarts and logs, obscures which credential was used for protected-resource access, and complicates secure recovery from session-store failures.
