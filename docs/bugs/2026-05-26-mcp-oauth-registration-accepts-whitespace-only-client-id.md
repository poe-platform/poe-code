# MCP OAuth registration accepts whitespace-only client ID

## Summary

The exported `@poe-code/mcp-oauth` default client provider accepts a dynamic client-registration response whose `client_id` consists only of spaces. It then opens the authorization flow and submits the token exchange using that blank-effective client identifier, instead of rejecting the unusable registration response.

## Reproduction

Create a disposable Vitest probe at `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createDefaultOAuthClientProvider, type OAuthDiscoveryResult } from "./index.js";

const resource = "https://mcp.example.com/";
const authorizationServer = "https://auth.example.com";
const tokenEndpoint = `${authorizationServer}/token`;
const registrationEndpoint = `${authorizationServer}/register`;
const discovery: OAuthDiscoveryResult = {
  resource,
  resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource",
  resourceMetadata: { resource, authorization_servers: [authorizationServer] },
  authorizationServer,
  authorizationServerMetadataUrl: `${authorizationServer}/.well-known/oauth-authorization-server`,
  authorizationServerMetadata: {
    issuer: authorizationServer,
    authorization_endpoint: `${authorizationServer}/authorize`,
    token_endpoint: tokenEndpoint,
    registration_endpoint: registrationEndpoint,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"]
  }
};

async function callback(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    http.get(url, (response) => {
      response.resume();
      response.once("end", resolve);
    }).once("error", reject);
  });
}

describe("mcp-oauth whitespace dynamic registration client id", () => {
  it("accepts and transmits a whitespace-only client id from registration", async () => {
    let browserClientId: string | null = null;
    let tokenClientId: string | null = null;
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "dynamic", metadata: { clientName: "probe" } },
      browser: {
        openBrowser: async (authorizationUrl) => {
          const authorization = new URL(authorizationUrl);
          browserClientId = authorization.searchParams.get("client_id");
          const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
          redirect.searchParams.set("code", "approved");
          redirect.searchParams.set("state", authorization.searchParams.get("state")!);
          await callback(redirect.toString());
        }
      }
    });
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(input) === registrationEndpoint) {
        return new Response(JSON.stringify({
          client_id: "   ",
          token_endpoint_auth_method: "none"
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      expect(String(input)).toBe(tokenEndpoint);
      tokenClientId = new URLSearchParams(String(init?.body ?? "")).get("client_id");
      return new Response(JSON.stringify({ access_token: "access", token_type: "Bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    await expect(provider.handleUnauthorized({
      requestUrl: new URL(resource),
      response: new Response(null, { status: 401 }),
      challenge: null,
      discovery,
      fetch
    })).resolves.toEqual({ action: "retry" });

    expect(browserClientId).toBe("   ");
    expect(tokenClientId).toBe("   ");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/mcp-oauth/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/mcp-oauth/src/__probe__.test.ts > mcp-oauth whitespace dynamic registration client id > accepts and transmits a whitespace-only client id from registration
```

## Observed Behavior

When dynamic registration returns `{ "client_id": "   " }`, the provider completes the authorization exchange, with both the browser authorization URL and token-request body containing the exact whitespace-only client identifier. It then reports `{ action: "retry" }` after receiving an access token.

`packages/mcp-oauth/src/client/default-oauth-client-provider.ts:372` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:412` process a fresh dynamic registration. Its only `client_id` validation at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:392` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:397` rejects empty raw strings but accepts strings containing only whitespace. The accepted value is used in the authorization URL at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:251` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:260`, and is passed into the token exchange at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:261` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:272`.

## Expected Behavior

Dynamic registration should accept only usable nonblank client identifiers. A whitespace-only `client_id` must be rejected as a malformed registration response rather than persisted or transmitted into subsequent OAuth requests.

## Impact

A malformed or compromised authorization server can make dynamic registration appear successful while providing an unusable client identity. The MCP client proceeds through interactive authorization and token exchange using a blank-effective client identifier, causing confusing downstream failures or invalid persisted registration state instead of reporting the source protocol violation immediately.
