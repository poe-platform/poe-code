# Poe OAuth malformed successful token JSON loses token-endpoint context

## Summary

The exported `@poe-code/poe-oauth` `createOAuthClient()` flow directly awaits `response.json()` after a successful token-exchange HTTP response. If the Poe token endpoint returns malformed JSON with a `200` status, OAuth authorization rejects with a raw JavaScript `SyntaxError` rather than a token-exchange error that identifies the failed endpoint or operation.

## Reproduction

Create the following disposable probe at `packages/poe-oauth/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createOAuthClient } from "./oauth-client.js";

function createMockServer(): { server: http.Server; simulateCallback: (url: string) => void } {
  let requestHandler: ((request: http.IncomingMessage, response: http.ServerResponse) => void) | null = null;

  const server = {
    on: vi.fn((event: string, handler: typeof requestHandler) => {
      if (event === "request") requestHandler = handler;
      return server;
    }),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(callback);
      return server;
    }),
    close: vi.fn((callback?: () => void) => {
      callback?.();
      return server;
    }),
    address: vi.fn(() => ({ port: 54321 }))
  } as unknown as http.Server;

  return {
    server,
    simulateCallback(url: string) {
      if (!requestHandler) throw new Error("No request handler registered");
      requestHandler({ url, method: "GET" } as http.IncomingMessage, {
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as http.ServerResponse);
    }
  };
}

describe("poe-oauth malformed successful token response", () => {
  it("surfaces an uncontextualized JSON parser exception", async () => {
    const { server, simulateCallback } = createMockServer();
    const client = createOAuthClient({
      clientId: "test-client-id",
      tokenEndpoint: "https://api.poe.com/token",
      createServer: () => server,
      openBrowser: vi.fn(async () => simulateCallback("/callback?code=auth-code")),
      fetch: vi.fn(async () => new Response('{"api_key":', {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as unknown as typeof fetch
    });

    const authorization = await client.authorize();
    let rejected: unknown;
    try {
      await authorization.waitForResult();
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(SyntaxError);
    expect((rejected as Error).message).not.toContain("https://api.poe.com/token");
    expect((rejected as Error).message).not.toContain("Token exchange failed");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
rm packages/poe-oauth/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/poe-oauth/src/__probe__.test.ts > poe-oauth malformed successful token response > surfaces an uncontextualized JSON parser exception
```

## Observed Behavior

`packages/poe-oauth/src/index.ts` exposes `createOAuthClient()`. During `authorization.waitForResult()`, `exchangeCodeForApiKey()` in `packages/poe-oauth/src/oauth-client.ts` reports non-success HTTP token responses as `Token exchange failed (...)`, but a `200` response body containing malformed JSON reaches the unguarded `await response.json()` call and rejects with an unwrapped `SyntaxError`. The exception neither identifies the token endpoint nor indicates that OAuth token exchange failed.

## Expected Behavior

Malformed success payloads from the OAuth token endpoint should reject with a contextual token-exchange error, preserving the operation or endpoint that failed while retaining parse details as appropriate.

## Impact

A malformed or truncated successful token response produces an opaque parser failure during interactive login. Users and callers cannot distinguish a token-endpoint response defect from unrelated local JSON parsing failures, making OAuth authentication failures harder to diagnose and recover from.
