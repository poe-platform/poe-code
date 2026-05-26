# MCP OAuth malformed stored access token is emitted as a bearer header

## Summary

`mcp-oauth`'s exported auth-store session adapter accepts any persisted JSON object as a typed `StoredOAuthSession` without validating nested token fields. A corrupted or incompatible stored session whose `tokens.accessToken` is a number is loaded successfully and then used by the default OAuth provider to send `Authorization: Bearer 42` on a protected-resource request.

## Reproduction

Add the following temporary probe as `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("auth-store", () => ({
  createSecretStore: () => ({
    store: {
      get: async () => JSON.stringify({
        resource: "https://resource.example/mcp",
        authorizationServer: "https://auth.example",
        client: { clientId: "client" },
        tokens: { accessToken: 42, tokenType: "Bearer", expiresAt: null },
        discovery: { resourceMetadataUrl: "metadata", resourceMetadata: {}, authorizationServerMetadata: {} }
      }),
      set: async () => undefined,
      delete: async () => undefined
    }
  })
}));

import { createAuthStoreSessionStore } from "./client/auth-store-session-store.js";
import { createDefaultOAuthClientProvider } from "./client/default-oauth-client-provider.js";

describe("malformed persisted OAuth token fields", () => {
  it("loads a non-string access token and emits it as an Authorization bearer", async () => {
    const sessionStore = createAuthStoreSessionStore();
    const loaded = await sessionStore.load("https://resource.example/mcp");
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" },
      browser: { openBrowser: async () => undefined },
      sessionStore,
      now: () => 0
    });
    const headers = new Headers();

    await provider.authorizeRequest!({
      requestUrl: new URL("https://resource.example/mcp"),
      headers,
      fetch: async () => new Response()
    });

    console.log(JSON.stringify({ loadedToken: loaded?.tokens?.accessToken, authorization: headers.get("Authorization") }));
    expect(loaded?.tokens?.accessToken).toBe(42);
    expect(headers.get("Authorization")).toBe("Bearer 42");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
rm packages/mcp-oauth/src/__probe__.test.ts
nl -ba packages/mcp-oauth/src/client/types.ts | sed -n '62,89p'
nl -ba packages/mcp-oauth/src/client/auth-store-session-store.ts | sed -n '32,58p'
nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '50,63p;99,127p;475,477p'
```

The reproduction passes and shows both the invalid loaded value and the transmitted bearer header:

```text
{"loadedToken":42,"authorization":"Bearer 42"}
✓ packages/mcp-oauth/src/__probe__.test.ts > malformed persisted OAuth token fields > loads a non-string access token and emits it as an Authorization bearer
```

## Observed Behavior

The public `StoredOAuthTokens` type requires `accessToken: string`, `tokenType: "Bearer"`, and `expiresAt: number | null` in `packages/mcp-oauth/src/client/types.ts:62` through `packages/mcp-oauth/src/client/types.ts:89`. However, `createAuthStoreSessionStore().load()` parses stored JSON and accepts any non-array object via a type assertion at `packages/mcp-oauth/src/client/auth-store-session-store.ts:32` through `packages/mcp-oauth/src/client/auth-store-session-store.ts:58`, without validating required session or token members. `createDefaultOAuthClientProvider()` then treats the numeric token as non-expired because its `expiresAt` is `null`, retrieves `session.tokens.accessToken`, and interpolates it into the outgoing authorization header at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:50` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:63`, `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:99` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:127`, and `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:475` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:477`.

## Expected Behavior

Persisted OAuth sessions should be validated against their public runtime shape before being returned or used for authentication. A stored session containing a non-string access token should be rejected or treated as unusable, never converted into a bearer credential on a network request.

## Impact

Corrupted, partially migrated, or version-incompatible credential files can cause MCP clients to transmit invalid authorization credentials rather than safely discarding unusable state and reauthorizing. This creates confusing authentication failures, leaks malformed stored values into outbound requests, and undermines the typed session-store boundary relied on by OAuth callers.
